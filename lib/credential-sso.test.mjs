import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { normalizeSsoRule, matchesLoginReturn, loginEvidence, loginEvidenceAccepted } = await jiti.import("../desktop/src/credential-sso.ts");
const auth = "https://sso.example.com/login", business = "http://portal.internal:8080/app";
const ready = { ready: true, loginVisible: false, authenticated: true, url: business };
const sample = { url: auth, username: "synthetic-user", password: "synthetic-password" };
test("SSO binds exact origins and segment-aware paths without aliasing the password to the business site", () => {
  const context = loginEvidence(auth, business, []);
  assert.deepEqual(context, { returnUrl: business });
  assert.equal(matchesLoginReturn(business, business + "/home?x=1"), true);
  for (const wrong of [business + "-evil", "http://portal.internal/app", "http://portal.internal.evil:8080/app", auth]) assert.equal(loginEvidenceAccepted(auth, context, { ...ready, url: wrong }), false);
  assert.equal(loginEvidenceAccepted(auth, context, ready), true);
  for (const status of [{ failed: true }, { challenge: true }, { loginVisible: true }, { ready: false }]) assert.equal(loginEvidenceAccepted(auth, context, { ...ready, ...status }), false);
});
test("meta and cookie evidence require explicit rule selection and fresh cookie evidence", () => {
  for (const evidence of ["meta", "cookie"]) {
    const rule = normalizeSsoRule({ id: evidence, authOrigin: new URL(auth).origin, returnUrl: business, evidence, cookieName: "session" });
    const context = loginEvidence(auth, undefined, [rule]);
    assert.equal(loginEvidenceAccepted(auth, context, ready), false);
    assert.equal(loginEvidenceAccepted(auth, context, { ...ready, declaredAuthenticated: true }, true), true);
  }
  assert.equal(loginEvidenceAccepted(auth, { returnUrl: business }, { ...ready, authenticated: false, declaredAuthenticated: true }, true), false);
  assert.throws(() => normalizeSsoRule({ authOrigin: "https://sso.example.com/anything", returnUrl: business, evidence: "dom" }));
});
async function fixture(t, rules = []) {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-sso-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const electron = path.join(directory, "electron.cjs");
  await writeFile(electron, "module.exports={app:{},ipcMain:{},safeStorage:{},session:{}};");
  const loader = createJiti(import.meta.url, { alias: { electron } });
  const { DesktopBrowserManager } = await loader.import("../desktop/src/browser-manager.ts");
  const manager = Object.create(DesktopBrowserManager.prototype), saved = [];
  let state = { ...ready, loginVisible: true, authenticated: false, url: auth }, cookie = "old", allowed = true;
  const store = { allowedUrl: () => allowed, ssoRules: () => rules, rememberLogin: value => saved.push(value), rememberedStatus: () => ({ enabled: true, entries: saved.map(value => ({ url: value.url, enabled: true })) }) };
  manager.startup = { credentialVault: () => store };
  manager.rememberedCandidates = new Map(); manager.protectedWatchers = new Map();
  manager.sendState = () => {};
  manager.browserSession = { cookies: { get: async () => cookie ? [{ domain: "portal.internal", path: "/", value: cookie }] : [] } };
  const tab = { id: "auth", sessionId: "chat", loginEntryUrl: business, documentEpoch: 1, view: { webContents: { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: async () => state } } };
  manager.tabs = [tab];
  t.after(() => { for (const pending of manager.rememberedCandidates.values()) clearInterval(pending.timer); });
  return { manager, tab, saved, store, setState: value => { state = value; }, setCookie: value => { cookie = value; }, revoke: () => { allowed = false; } };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 320));
test("manager saves only the captured authentication URL after the bound business return", async t => {
  const f = await fixture(t);
  f.manager.observeRememberedLogin(f.tab, sample);
  f.setState({ ...ready, url: "https://unrelated.example.com/home" }); await tick();
  assert.equal(f.saved.length, 0);
  f.setState(ready); await tick();
  assert.deepEqual(f.saved, [sample]);
  assert.equal(f.tab.loginNotice, "saved");
});
test("cookie evidence never saves from an unchanged old session, and does not leave secrets in status", async t => {
  const rule = normalizeSsoRule({ id: "one", authOrigin: new URL(auth).origin, returnUrl: business, evidence: "cookie", cookieName: "session" });
  const f = await fixture(t, [rule]);
  f.manager.observeRememberedLogin(f.tab, sample);
  f.setState({ ...ready, authenticated: false }); await tick();
  assert.equal(f.saved.length, 0);
  f.setCookie("new-session"); await tick();
  assert.equal(f.saved.length, 1);
  assert.doesNotMatch(f.tab.loginNotice, /new-session|synthetic/);
});
test("policy revocation during a pending SSO flow discards the candidate", async t => {
  const f = await fixture(t);
  f.manager.observeRememberedLogin(f.tab, sample);
  f.revoke(); f.setState(ready); await tick();
  assert.equal(f.saved.length, 0);
  assert.equal(f.manager.rememberedCandidates.size, 0);
});
test("a generic authenticated signal cannot bypass pending return verification", async t => {
  const f = await fixture(t);
  f.tab.vaultProtected = true;
  f.manager.observeRememberedLogin(f.tab, sample);
  assert.equal(f.manager.finishProtectedLogin(f.tab.id, true), f.tab.id);
  assert.equal(f.saved.length, 0);
  assert.equal(f.manager.rememberedCandidates.size, 1);
});

test("popup completion requires a new navigation in the recorded opener and never opens the auth page again", async t => {
  const f = await fixture(t);
  const parent = { id: "business", sessionId: "chat", documentEpoch: 1, view: { webContents: { isDestroyed: () => false, getURL: () => business, executeJavaScriptInIsolatedWorld: async () => ready } } };
  f.manager.tabs.push(parent);
  f.tab.loginParentTabId = parent.id;
  const closed = [];
  f.manager.closeTab = id => closed.push(id);
  f.manager.observeRememberedLogin(f.tab, sample);
  await tick();
  assert.equal(f.saved.length, 0, "an existing user menu cannot complete this login");
  parent.documentEpoch++;
  await tick();
  assert.deepEqual(f.saved, [sample]);
  assert.deepEqual(closed, [f.tab.id]);
  assert.equal(parent.loginNotice, "saved");
});

test("a legacy step alias cannot copy an authentication password to a foreign origin", async t => {
  const f = await fixture(t);
  f.manager.rememberAccount({ ...sample, startUrl: business });
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].url, auth);
});

test("manual fill rechecks unlock and account existence after asynchronous form inspection", async t => {
  const f = await fixture(t);
  let finish, valid = true, executions = 0;
  f.tab.view.webContents.getURL = () => auth;
  f.tab.view.webContents.executeJavaScriptInIsolatedWorld = () => { executions++; return new Promise(resolve => { finish = resolve; }); };
  f.store.allowedOrigins = () => [];
  f.store.credential = () => { if (!valid) throw new Error("locked or deleted"); return sample; };
  const pending = f.manager.fillCredential("one", f.tab);
  valid = false; finish(true);
  await assert.rejects(pending, /locked or deleted/);
  assert.equal(executions, 1, "no fill script is executed after revocation");
});

test("explicit release cancels a popup candidate instead of leaving it for the opener", async t => {
  const f = await fixture(t);
  f.manager.loginControllers = new Map();
  f.manager.displayedSessionId = "chat";
  f.manager.updateVisibility = () => {};
  f.manager.closeTab = () => {};
  f.tab.vaultProtected = true;
  f.manager.observeRememberedLogin(f.tab, sample);
  await f.manager.releaseCredentials();
  f.setState(ready); await tick();
  assert.equal(f.saved.length, 0);
  assert.equal(f.manager.rememberedCandidates.size, 0);
});
