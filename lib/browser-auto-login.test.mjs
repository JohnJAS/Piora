import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "piora-auto-login-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const electron = path.join(root, "electron.cjs");
  await writeFile(electron, "module.exports={app:{},ipcMain:{},safeStorage:{},session:{},dialog:{}};");
  const loader = createJiti(import.meta.url, { alias: { electron } });
  const { DesktopBrowserManager } = await loader.import("../desktop/src/browser-manager.ts");
  const manager = Object.create(DesktopBrowserManager.prototype);
  for (const name of ["loginRecoveries", "loginControllers", "originRecoveries", "rememberedCandidates", "protectedWatchers"]) manager[name] = new Map();
  t.after(() => { for (const timer of manager.protectedWatchers.values()) clearInterval(timer); });
  manager.sendState = () => {};
  manager.tabs = [];
  const login = { ready: true, authenticated: false, loginVisible: true, url: "https://accounts.example.com/login" };
  const tab = id => {
    const record = { id, sessionId: "manual", documentEpoch: 1, view: { webContents: {
      isDestroyed: () => false, getURL: () => login.url,
      executeJavaScriptInIsolatedWorld: async () => login,
      loadURL: async () => {}, debugger: { isAttached: () => false },
    } } };
    manager.tabs.push(record);
    return record;
  };
  manager.startup = { credentialVault: () => ({ automaticCredential: () => ({ url: login.url }), candidates: () => [] }) };
  return { manager, tab, login };
}

test("manual navigation and repeated form observations start a single automatic recovery", async t => {
  const { manager, tab } = await fixture(t);
  const page = tab("one");
  let calls = 0;
  manager.recoverLogin = async () => { calls++; return { status: "ready", tabId: page.id }; };
  await Promise.all([manager.autoFillCredential(page), manager.autoFillCredential(page)]);
  await manager.autoFillCredential(page);
  assert.equal(calls, 1);
  page.documentEpoch++;
  await manager.autoFillCredential(page);
  assert.equal(calls, 2, "a later visit can recover again");
});

test("verification challenges show a reason without submitting credentials", async t => {
  const { manager, tab, login } = await fixture(t);
  login.challenge = true;
  const page = tab("challenge");
  manager.recoverLogin = () => { throw new Error("must not run"); };
  await manager.autoFillCredential(page);
  assert.equal(page.loginNotice, "challenge");
});

test("same-origin tabs wait for shared login before refreshing their login page", async t => {
  const { manager, tab } = await fixture(t);
  const first = tab("first"), second = tab("second");
  let finish, secondRuns = 0, reloads = 0;
  second.view.webContents.loadURL = async () => { reloads++; };
  manager.runLoginRecovery = async id => {
    if (id === first.id) return new Promise(resolve => { finish = resolve; });
    secondRuns++;
    return { status: "ready", tabId: id };
  };
  const one = manager.recoverLogin(first.id, new AbortController().signal);
  const two = manager.recoverLogin(second.id, new AbortController().signal);
  assert.equal(secondRuns, 0);
  finish({ status: "ready", tabId: first.id });
  await Promise.all([one, two]);
  assert.equal(secondRuns, 1);
  assert.equal(reloads, 1);
  assert.equal(manager.originRecoveries.size, 0);
});

test("confirmed full-page navigation keeps the actual page and its session state", async t => {
  const { manager, tab } = await fixture(t);
  const page = tab("preserved");
  manager.protectCredentialTab(page);
  page.documentEpoch++;
  manager.closeTab = () => { throw new Error("must preserve page"); };
  manager.createTab = () => { throw new Error("must not repeat GET"); };
  assert.equal(manager.finishProtectedLogin(page.id), page.id);
  assert.equal(page.vaultProtected, false);
});

test("cancelling a queued login does not wait for or cancel the first tab", async t => {
  const { manager, tab } = await fixture(t);
  const first = tab("first"), second = tab("second");
  let finish;
  manager.runLoginRecovery = async id => {
    assert.equal(id, first.id);
    return new Promise(resolve => { finish = resolve; });
  };
  const one = manager.recoverLogin(first.id, new AbortController().signal);
  const controller = new AbortController();
  const two = manager.recoverLogin(second.id, controller.signal);
  controller.abort();
  await assert.rejects(two, /aborted/);
  finish({ status: "ready", tabId: first.id });
  assert.equal((await one).status, "ready");
});

test("an agent joining automatic recovery can cancel it before password submission", async t => {
  const { manager, tab } = await fixture(t);
  const page = tab("joined");
  manager.runLoginRecovery = async (_id, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  const automatic = manager.recoverLogin(page.id, new AbortController().signal);
  const controller = new AbortController();
  const joined = manager.recoverLogin(page.id, controller.signal);
  controller.abort();
  await Promise.all([assert.rejects(automatic, /aborted/), assert.rejects(joined, /aborted/)]);
  assert.equal(manager.loginRecoveries.size, 0);
});

test("explicit user navigation discards pending credentials and aborts recovery", async t => {
  const { manager, tab } = await fixture(t);
  const page = tab("abandon");
  const controller = new AbortController();
  manager.loginControllers.set(page.id, controller);
  const timer = setInterval(() => { throw new Error("candidate must be cancelled"); }, 1000);
  manager.rememberedCandidates.set(page.id, { value: { password: "not-saved" }, timer });
  page.loginUsername = { username: "not-saved" };
  manager.protectCredentialTab(page);
  manager.abandonLogin(page);
  assert.equal(controller.signal.aborted, true);
  assert.equal(manager.rememberedCandidates.size, 0);
  assert.equal(page.loginUsername, undefined);
  assert.equal(page.vaultProtected, true, "old document remains private until navigation commits");
  assert.equal(page.releaseAfterNavigation, true);
});

test("a queued tab that navigated elsewhere does not reload or submit the new page", async t => {
  const { manager, tab } = await fixture(t);
  const first = tab("first"), second = tab("second");
  let finish;
  manager.runLoginRecovery = async id => {
    assert.equal(id, first.id);
    return new Promise(resolve => { finish = resolve; });
  };
  const one = manager.recoverLogin(first.id, new AbortController().signal);
  const two = manager.recoverLogin(second.id, new AbortController().signal);
  second.view.webContents.getURL = () => "https://business.example.com/order";
  second.view.webContents.loadURL = () => { throw new Error("must not replay navigation"); };
  finish({ status: "ready", tabId: first.id });
  await one;
  assert.equal((await two).status, "needs-user");
});

test("same-document SPA login still discards the document that handled the password", async t => {
  const { manager, tab } = await fixture(t);
  const page = tab("spa");
  manager.protectCredentialTab(page);
  page.documentEpoch++;
  manager.protectCredentialTab(page); // Password entered after username navigation.
  const closed = [];
  manager.closeTab = id => closed.push(id);
  manager.createTab = () => ({ id: "replacement" });
  assert.equal(manager.finishProtectedLogin(page.id), "replacement");
  assert.deepEqual(closed, ["spa"]);
});

test("manual MFA completion after automatic recovery restores a tab without an agent wait", async t => {
  const { manager, tab, login } = await fixture(t);
  const page = tab("mfa");
  manager.protectCredentialTab(page);
  login.challenge = true;
  manager.watchProtectedLogin(page);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(page.vaultProtected, true);
  page.documentEpoch++;
  Object.assign(login, { challenge: false, loginVisible: false, authenticated: true, url: "https://accounts.example.com/home" });
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(page.vaultProtected, false);
  assert.equal(page.loginNotice, "restored");
  assert.equal(manager.protectedWatchers.size, 0);
});
