import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
const { BrowserPermissions } = await createJiti(import.meta.url).import("../desktop/src/browser-permissions.ts");

function fixture(t, answer = { decision: true, remember: true }) {
  const directory = mkdtempSync(join(tmpdir(), "piora-permissions-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "permissions.json");
  const contents = {}, page = { url: "https://meet.example.com/call", documentId: "tab1:1", visible: true };
  const prompts = []; let respond = async () => answer, closed = false;
  const host = {
    page: target => target === contents && !closed ? page : null,
    prompt: async (...args) => { prompts.push(args); return respond(...args); },
    warn: error => { throw error; },
  };
  let check, request;
  const session = { setPermissionCheckHandler: handler => { check = handler; }, setPermissionRequestHandler: handler => { request = handler; } };
  let permissions = new BrowserPermissions(file, host); permissions.install(session);
  return {
    page, prompts, file, contents,
    close: () => { closed = true; },
    respond: callback => { respond = callback; },
    reset: () => permissions.reset(page.url),
    range: (since, until, clear) => permissions.range(since, until, clear),
    reload: () => { permissions = new BrowserPermissions(file, host); permissions.install(session); },
    check: (permission, details = {}, target = contents) => check(target, permission, new URL(page.url).origin,
      { isMainFrame: true, requestingUrl: page.url, ...details }),
    request: (permission, details = {}, target = contents) => new Promise(resolve => request(target, permission, resolve,
      { isMainFrame: true, requestingUrl: page.url, ...details })),
  };
}

test("remembers native permission decisions across documents and reloads for the exact origin", async t => {
  const f = fixture(t);
  assert.equal(f.check("notifications"), false);
  assert.equal(await f.request("notifications"), true);
  assert.deepEqual(f.prompts, [["https://meet.example.com", ["通知"]]]);
  assert.equal(f.check("notifications"), true);
  f.reload(); f.page.documentId = "tab1:2"; f.page.visible = false;
  assert.equal(await f.request("notifications"), true);
  assert.equal(f.prompts.length, 1);
  f.page.url = "https://other.example.com/";
  assert.equal(f.check("notifications"), false);
  assert.equal(await f.request("notifications"), false);
  f.page.visible = true; f.page.url = "https://meet.example.com:8443/";
  assert.equal(f.check("notifications"), false);
});

test("microphone grants never grant camera or unspecified media", async t => {
  const f = fixture(t);
  assert.equal(await f.request("media", { mediaTypes: ["audio"] }), true);
  assert.equal(f.check("media", { mediaType: "audio" }), true);
  assert.equal(f.check("media", { mediaType: "video" }), false);
  assert.equal(f.check("media", { mediaType: "unknown" }), false);
  assert.equal(await f.request("media"), false);
  f.respond(async () => ({ decision: false, remember: true }));
  assert.equal(await f.request("media", { mediaTypes: ["audio", "video"] }), false);
  assert.deepEqual(f.prompts[1], ["https://meet.example.com", ["摄像头"]]);
  f.reload();
  assert.equal(f.check("media", { mediaType: "audio" }), true);
  assert.equal(f.check("media", { mediaType: "video" }), false);
  assert.equal(await f.request("media", { mediaTypes: ["video"] }), false);
  assert.equal(f.prompts.length, 2);
});

test("combined media consent stores both exact capabilities", async t => {
  const f = fixture(t);
  assert.equal(await f.request("media", { mediaTypes: ["video", "audio"] }), true);
  assert.equal(f.check("media", { mediaType: "video" }), true);
  assert.equal(f.check("media", { mediaType: "audio" }), true);
  assert.equal(f.check("display-capture"), false);
  assert.equal(await f.request("display-capture", { mediaTypes: ["video"] }), false);
  assert.equal(f.prompts.length, 1);
});

test("denials are remembered and reset makes the permission requestable again", async t => {
  const f = fixture(t, { decision: false, remember: true });
  assert.equal(await f.request("geolocation"), false);
  f.reload();
  assert.equal(await f.request("geolocation"), false);
  assert.equal(f.prompts.length, 1);
  f.reset(); f.respond(async () => ({ decision: true, remember: true }));
  assert.equal(await f.request("geolocation"), true);
  assert.equal(f.prompts.length, 2);
});

test("dismissal is not persisted and unremembered consent lasts only for its document", async t => {
  const f = fixture(t, { decision: null, remember: true });
  assert.equal(await f.request("geolocation"), false);
  f.respond(async () => ({ decision: true, remember: false }));
  assert.equal(await f.request("geolocation"), true);
  assert.equal(f.check("geolocation"), true);
  f.page.documentId = "tab1:2";
  assert.equal(f.check("geolocation"), false);
  f.reload();
  assert.equal(f.check("geolocation"), false);
});

test("hidden, foreign, non-main-frame, insecure and unsupported requests never prompt", async t => {
  const f = fixture(t);
  for (const details of [{ isMainFrame: false }, { requestingUrl: "https://evil.example/" }, { securityOrigin: "https://evil.example/" }, { requestingUrl: "" }]) {
    assert.equal(await f.request("notifications", details), false);
  }
  assert.equal(await f.request("notifications", {}, {}), false);
  assert.equal(f.check("notifications", {}, null), false);
  f.page.visible = false;
  assert.equal(await f.request("notifications"), false);
  f.page.visible = true; f.page.url = "http://meet.example.com/";
  assert.equal(await f.request("notifications"), false);
  f.page.url = "https://meet.example.com/";
  assert.equal(await f.request("fileSystem"), false);
  assert.equal(await f.request("unknown"), false);
  assert.equal(f.prompts.length, 0);
});

test("navigation, closing, hiding or reset during native prompt never grants or persists stale consent", async t => {
  for (const invalidate of [f => { f.page.documentId = "tab1:2"; }, f => { f.page.url = "https://elsewhere.example/"; }, f => { f.page.visible = false; }, f => { f.reset(); }, f => { f.close(); }]) {
    const f = fixture(t); let resolve, started;
    const ready = new Promise(done => { started = done; });
    f.respond(() => new Promise(done => { resolve = done; started(); }));
    const pending = f.request("notifications"); await ready;
    invalidate(f); resolve({ decision: true, remember: true });
    assert.equal(await pending, false);
    f.reload(); assert.equal(f.check("notifications"), false);
  }
});

test("duplicate simultaneous permission requests share one prompt", async t => {
  const f = fixture(t); let resolve, started;
  const ready = new Promise(done => { started = done; });
  f.respond(() => new Promise(done => { resolve = done; started(); }));
  const first = f.request("notifications"), second = f.request("notifications");
  await ready; assert.equal(f.prompts.length, 1);
  resolve({ decision: true, remember: true });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
});

test("corrupt and unsupported stored grants do not authorize permissions", async t => {
  const f = fixture(t);
  writeFileSync(f.file, JSON.stringify({ version: 1, origins: {
    "https://meet.example.com": { media: true, "media:audio": "true", unknown: true, notifications: true },
    "http://meet.example.com": { geolocation: true },
  } }));
  f.reload();
  assert.equal(f.check("notifications"), true);
  assert.equal(f.check("media", { mediaType: "audio" }), false);
  assert.equal(await f.request("unknown"), false);
  f.reset();
  assert.deepEqual(JSON.parse(readFileSync(f.file, "utf8")), { version: 2, origins: {}, times: {} });
});

test("legacy decisions survive a bounded clear and timestamped decisions honor both ends across restart", t => {
  const f = fixture(t), origin = new URL(f.page.url).origin;
  writeFileSync(f.file, JSON.stringify({version: 1, origins: { [origin]: { notifications: true } }}));
  f.reload();
  assert.equal(f.range(100, 300, true), 0);
  assert.equal(f.check("notifications"), true);
  writeFileSync(f.file, JSON.stringify({version: 2, origins: { [origin]: {
    notifications: true, geolocation: true, fullscreen: true, sensors: true, pointerLock: true
  } }, times: {
    [origin + "\nnotifications"]: 99, [origin + "\ngeolocation"]: 100,
    [origin + "\nfullscreen"]: 300, [origin + "\nsensors"]: 301
  }}));
  f.reload();
  assert.equal(f.range(100, 300, false), 2);
  assert.equal(f.range(100, 300, true), 2);
  f.reload();
  assert.equal(f.check("notifications"), true);
  assert.equal(f.check("geolocation"), false);
  assert.equal(f.check("fullscreen"), false);
  assert.equal(f.check("sensors"), true);
  assert.equal(f.range(0, 300, true), 2);
  assert.equal(f.check("notifications"), false);
  assert.equal(f.check("pointerLock"), false);
  assert.equal(f.check("sensors"), true);
});
