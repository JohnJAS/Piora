import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { CredentialVault, credentialUrl } = await jiti.import("../desktop/src/credential-vault.ts");
const master = "correct horse battery staple";
const sample = { name: "Work", url: "https://accounts.example.com/login", username: "private-user-812", password: "private-secret-173", group: "Work", notes: "Private note" };
function cipherFixture() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); const bytes = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decryptString(value) { const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString(); },
  };
}
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "piora-vault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "vault.enc"), cipher = cipherFixture();
  return { root, file, cipher, store: new CredentialVault(file, cipher) };
}

test("vault encrypts disk records, omits secrets in snapshots, retains edited passwords, and locks on restart", async t => {
  const { file, cipher, store } = await fixture(t);
  store.initialize(master); store.save(sample);
  const id = store.status().entries[0].id;
  assert.equal(store.status().autofill, false);
  assert.equal(JSON.stringify(store.status()).includes(sample.password), false);
  store.save({ id, name: "Renamed", password: "" });
  assert.equal(store.credential(id, sample.url).password, sample.password);
  store.record(id, sample.url);
  const bytes = await readFile(file);
  for (const secret of [sample.username, sample.password, sample.notes]) assert.equal(bytes.includes(Buffer.from(secret)), false);
  const restarted = new CredentialVault(file, cipher);
  assert.equal(restarted.status().unlocked, false);
  assert.throws(() => restarted.unlock("wrong password long enough"));
  assert.deepEqual(restarted.status().entries, []);
  restarted.unlock(master);
  assert.equal(restarted.status().audit[0].name, "Renamed");
  restarted.remove(id); assert.deepEqual(restarted.status().entries, []);
});

test("backup requires master verification, authenticates ciphertext, and imports atomically", async t => {
  const { store } = await fixture(t);
  store.initialize(master); store.save(sample);
  assert.throws(() => store.export("different master password"));
  const backup = store.export(master);
  assert.equal(backup.includes(Buffer.from(sample.password)), false);
  assert.throws(() => store.import(backup, "different master password"));
  const tampered = JSON.parse(backup.toString());
  tampered.data = Buffer.alloc(Buffer.from(tampered.data, "base64").length).toString("base64");
  assert.throws(() => store.import(Buffer.from(JSON.stringify(tampered)), master));
  assert.equal(store.status().entries.length, 1);
  store.import(backup, master);
  assert.equal(store.status().entries.length, 2);
  assert.notEqual(store.status().entries[0].id, store.status().entries[1].id);
});

test("matching is exact, autofill opt-in, ambiguous matches explicit, and unavailable encryption fails closed", async t => {
  const { store, file, cipher } = await fixture(t);
  store.initialize(master); store.save(sample);
  assert.deepEqual(store.candidates(sample.url, true), []);
  store.configure(true);
  assert.equal(store.candidates(sample.url, true).length, 1);
  for (const url of ["https://accounts.example.com.evil.com/login", "https://other.example.com/login", "https://accounts.example.com/other", "http://accounts.example.com/login"]) assert.deepEqual(store.candidates(url, false), []);
  for (const url of ["https://xn--example-fake.com/login", "https://127.0.0.1/login", "https://user:secret@accounts.example.com/login"]) assert.throws(() => credentialUrl(url));
  for (const route of ["password", "settings", "verify", "checkout"]) assert.equal(credentialUrl(`https://accounts.example.com/${route}`), `https://accounts.example.com/${route}`, "page purpose is checked from its form, not path keywords");
  store.save({ ...sample, name: "Another account" });
  assert.equal(store.candidates(sample.url, true).length, 2);
  const insecure = new CredentialVault(file, { ...cipher, getSelectedStorageBackend: () => "basic_text" });
  assert.throws(() => insecure.unlock(master));
  store.lock(); assert.deepEqual(store.candidates(sample.url, false), []);
});

test("failed persistence retains the previous valid in-memory record", async t => {
  const { store, cipher } = await fixture(t);
  store.initialize(master); store.save(sample);
  const id = store.status().entries[0].id;
  cipher.encryptString = () => { throw new Error("fixture write failure"); };
  assert.throws(() => store.remove(id));
  assert.equal(store.status().entries[0].id, id);
});

test("desktop IPC rejects untrusted senders and browser guard discards late reads until protected tabs close", async t => {
  const { root } = await fixture(t);
  const electron = path.join(root, "electron.cjs");
  await writeFile(electron, `const handlers=new Map(); module.exports={handlers, app:{getPath:()=>${JSON.stringify(root)}}, ipcMain:{removeHandler:k=>handlers.delete(k),handle:(k,h)=>handlers.set(k,h)}, safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},dialog:{}};`);
  const loader = createJiti(import.meta.url, { alias: { electron } });
  const { registerVaultHandlers, getCredentialVault } = await loader.import("../desktop/src/credential-vault-ipc.ts");
  const stub = await loader.import(electron);
  registerVaultHandlers({ owner: event => event.trusted ? { isDestroyed: () => false } : null, fill: async () => {}, release: async () => {} });
  const handler = stub.handlers.get("pi:credential-vault");
  for (const action of ["remember-configure", "remember-remove", "remember-toggle", "status", "initialize", "unlock", "lock", "save", "remove", "configure", "export", "import", "fill", "release"]) await assert.rejects(handler({}, { action }), /Untrusted/);
  const store = getCredentialVault(); store.initialize(master); store.save(sample);
  const { DesktopBrowserManager } = await loader.import("../desktop/src/browser-manager.ts");
  const manager = Object.create(DesktopBrowserManager.prototype);
  manager.startup = { credentialVault: () => store };
  manager.loginRecoveries = new Map();
  const { BROWSER_LOGIN_STATE_SCRIPT } = await jiti.import("../desktop/src/browser-login.ts");
  let fills = 0;
  const tab = { id: "one", sessionId: "chat", view: { webContents: { isDestroyed: () => false, getURL: () => sample.url, debugger: { isAttached: () => false }, executeJavaScriptInIsolatedWorld: async (_world, scripts) => { if (scripts[0].code === BROWSER_LOGIN_STATE_SCRIPT) return { ready: true, loginVisible: true, authenticated: false, url: sample.url }; fills++; return true; } } } };
  manager.tabs = [tab]; manager.displayedSessionId = "chat";
  manager.findTab = id => manager.tabs.find(item => item.id === id);
  manager.activeTab = () => tab;
  manager.sendState = () => {}; manager.updateVisibility = () => {};
  manager.closeTab = id => { manager.tabs = manager.tabs.filter(item => item.id !== id); };
  await manager.autoFillCredential(tab);
  assert.equal(fills, 0, "autofill starts off");
  store.configure(true); store.save({ ...sample, name: "Another account" });
  await manager.autoFillCredential(tab);
  assert.equal(fills, 0, "ambiguous accounts require manual selection");
  store.remove(store.status().entries[1].id);
  let finish;
  const lateRead = manager.credentialGuardedRead("one", () => new Promise(resolve => { finish = resolve; }));
  await manager.fillCredential(store.status().entries[0].id);
  assert.equal(tab.vaultProtected, true);
  finish(sample.password);
  await assert.rejects(lateRead, /private/);
  await assert.rejects(manager.credentialGuardedRead("one", async () => sample.password), /private/);
  assert.equal(fills, 2, "the eligible form is checked and filled without a session-wide pause");
  assert.equal(manager.tabState(tab).url, "about:blank");
  assert.equal(store.status().audit[0].name, sample.name);
  await manager.releaseCredentials();
  assert.equal(manager.tabs.length, 0);
  assert.equal(fills, 2, "releasing the protected page does not repeat credential filling");
});


test("automatic credentials require unique opt-in, survive lock/restart, revoke immediately and imports reset permission", async t => {
  const { file, cipher, store } = await fixture(t);
  store.initialize(master); store.save(sample);
  const id = store.status().entries[0].id;
  assert.equal(store.automaticCredential(sample.url), undefined);
  store.save({ id, autoLogin: true });
  const backup = store.export(master);
  store.lock();
  assert.equal(store.status().unlocked, false);
  assert.equal(store.automaticCredential(sample.url).password, sample.password);
  const restarted = new CredentialVault(file, cipher);
  assert.equal(restarted.automaticCredential(sample.url).username, sample.username);
  assert.equal(restarted.automaticCredential("https://evil.example.com/login"), undefined);
  assert.equal(restarted.automaticCredential("https://accounts.example.com/other"), undefined);
  restarted.unlock(master); restarted.save({ id, autoLogin: false });
  assert.equal(store.automaticCredential(sample.url), undefined);
  restarted.save({ id, autoLogin: true }); restarted.save(sample);
  assert.equal(restarted.automaticCredential(sample.url), undefined, "multiple matching accounts require user selection");
  restarted.remove(id); restarted.import(backup, master);
  assert.equal(restarted.status().entries.at(-1).autoLogin, false);
});


test("browser accounts default on without master setup, encrypt, revoke and stay separate from manual vault", async t => {
  const { file, cipher, store } = await fixture(t);
  assert.equal(store.status().initialized, false);
  assert.equal(store.status().remembered.enabled, true);
  store.rememberLogin(sample);
  assert.equal(store.status().initialized, false);
  assert.equal(store.status().unlocked, false);
  assert.equal(store.automaticCredential(sample.url).password, sample.password);
  const disk = await readFile(file + ".browser");
  assert.equal(disk.includes(Buffer.from(sample.password)), false);
  assert.equal(disk.includes(Buffer.from(sample.username)), false);
  assert.doesNotMatch(JSON.stringify(store.status()), /private-secret|private-user/);
  const restarted = new CredentialVault(file, cipher);
  assert.equal(restarted.automaticCredential(sample.url).password, sample.password);
  const id = restarted.status().remembered.entries[0].id;
  restarted.toggleRemembered(id, false); restarted.rememberLogin(sample);
  assert.equal(restarted.automaticCredential(sample.url), undefined);
  restarted.toggleRemembered(id, true);
  restarted.configureRemembered(false);
  assert.equal(restarted.automaticCredential(sample.url), undefined);
  restarted.configureRemembered(true);
  restarted.removeRemembered(id); restarted.rememberLogin(sample);
  assert.deepEqual(restarted.status().remembered.entries, [], "deletion must not be immediately undone by observation");
});


test("submitted accounts remain memory-only until a signed-in marker appears, failures and closed tabs are discarded", async t => {
  const { root, store } = await fixture(t);
  const electron = path.join(root, "electron.cjs");
  await writeFile(electron, 'module.exports={app:{},ipcMain:{},safeStorage:{},session:{}};');
  const loader = createJiti(import.meta.url, { alias: { electron } });
  const { DesktopBrowserManager } = await loader.import("../desktop/src/browser-manager.ts");
  const manager = Object.create(DesktopBrowserManager.prototype);
  manager.startup = { credentialVault: () => store }; manager.rememberedCandidates = new Map();
  manager.sendState = () => {};
  t.after(() => { for (const candidate of manager.rememberedCandidates.values()) clearInterval(candidate.timer); });
  let destroyed = false;
  let state = { ready: true, authenticated: false, loginVisible: true, url: sample.url };
  const tab = { id: "remember", view: { webContents: { isDestroyed: () => destroyed, executeJavaScriptInIsolatedWorld: async () => state } } };
  manager.observeRememberedLogin(tab, sample);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(store.status().remembered.entries, []);
  state = { ...state, loginVisible: false, url: "https://accounts.example.com/error" };
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(store.status().remembered.entries, [], "redirect-only error pages are not successful login");
  state = { ...state, authenticated: true, failed: true };
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.deepEqual(store.status().remembered.entries, [], "a stale user menu on an error page does not confirm sign-in");
  manager.observeRememberedLogin(tab, { ...sample, startUrl: "https://accounts.example.com/username" });
  state = { ...state, failed: false, authenticated: true, url: "https://accounts.example.com/home" };
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(store.automaticCredential(sample.url).password, sample.password);
  assert.equal(store.automaticCredential("https://accounts.example.com/username").password, sample.password, "a confirmed two-step login remembers only its observed start path");
  manager.observeRememberedLogin(tab, { ...sample, url: "https://another.example.com/login" });
  destroyed = true;
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(manager.rememberedCandidates.size, 0);
  assert.equal(store.status().remembered.entries.length, 2);
});
