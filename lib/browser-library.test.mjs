import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { BrowserLibrary, historyUrl } = await jiti.import("../desktop/src/browser/library.ts");
const { bindTabTools } = await jiti.import("../desktop/src/browser/tab-events.ts");
const { checkedViewport, BrowserDevices } = await jiti.import("../desktop/src/browser/devices.ts");
const { fitViewport } = await jiti.import("../desktop/src/browser/device-display.ts");
const { BrowserPrivacy } = await jiti.import("../desktop/src/browser/privacy.ts");
const { passwordCsv } = await jiti.import("../desktop/src/browser/password-csv.ts");

test("profile records survive restart, preserve SPA links, exclude credentials and never resurrect removed visits", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "piora-menu-history-"));
  const path = join(dir, "library.sqlite");
  let store = new BrowserLibrary(path);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const first = store.visit("https://writer.test/#/book/1", "中文章节", "navigation", 100);
  const current = store.visit("https://writer.test/#/book/2", "第二章", "navigation", 200);
  const duplicate = store.visit("https://writer.test/#/book/1", "中文章节·更新", "navigation", 300);
  for (const url of [
    "about:blank",
    "file:///settings",
    "https://user:pw@writer.test/",
    "https://writer.test/?%63ode=x",
    "https://writer.test/#/auth?access_token=x",
    "https://writer.test/oauth/callback",
  ])
    assert.equal(historyUrl(url), null, url);
  assert.deepEqual(
    store.history({ text: "中文", suggestions: true }).map((row) => row.id),
    [duplicate],
  );
  store.deleteVisit(duplicate);
  store.title(duplicate, "late title");
  assert.equal(store.history({ text: "late title" }).length, 0);
  assert.deepEqual(
    store.history({ since: 200, until: 200 }).map((row) => row.id),
    [current],
  );
  assert.equal(store.range("history", 200, 200, true), 1);
  const interrupted = store.startDownload("unfinished", "https://writer.test/file", 100),
    completed = store.startDownload("saved", "https://writer.test/saved", 120);
  const saved = join(dir, "saved");
  await writeFile(saved, "complete");
  store.updateDownload(completed, saved, 8, 8, "completed", 350);
  assert.equal(store.range("downloads", 0, 300, true), 0, "downloads active at the selection cutoff survive");
  store.close();
  store = new BrowserLibrary(path);
  assert.deepEqual(
    store.history({}).map((row) => row.id),
    [first],
  );
  assert.equal(store.transfer(interrupted).state, "interrupted");
  assert.equal(store.describe(store.transfer(completed), false, false).missing, false);
  await rm(saved);
  assert.equal(store.describe(store.transfer(completed), false, false).missing, true);
  await writeFile(saved, "complete");
  store.deleteTransfer(completed);
  assert.equal(await readFile(saved, "utf8"), "complete");
  store.updateDownload(completed, saved, 10, 10, "completed", 500);
  assert.equal(store.transfer(completed), undefined);
});

test("only successful main navigations enter history and late titles cannot recreate deleted visits", (t) => {
  const store = new BrowserLibrary(":memory:");
  t.after(() => store.close());
  const contents = new EventEmitter();
  let url = "https://site.test/",
    privateEntry = false;
  contents.getURL = () => url;
  contents.getTitle = () => "书籍";
  bindTabTools(
    contents,
    { sessionId: "a", tabId: "t" },
    { current: () => true, recordable: () => !privateEntry, focusHost() {}, error() {} },
    store,
    { bind() {} },
    () => {},
  );
  contents.emit("did-navigate", {}, url, 200);
  contents.emit("did-finish-load");
  assert.equal(store.history({})[0].title, "书籍");
  contents.emit("did-navigate-in-page", {}, "https://frame.test/", false);
  url += "#/chapter/3";
  contents.emit("did-navigate-in-page", {}, url, true);
  contents.emit("did-navigate-in-page", {}, url, true);
  const last = store.history({})[0];
  assert.equal(last.url, url);
  store.deleteVisit(last.id);
  contents.emit("page-title-updated", {}, "已迟到");
  contents.emit("did-navigate", {}, "https://site.test/missing", 404);
  contents.emit("did-navigate-in-page", {}, "https://site.test/missing#retry", true);
  privateEntry = true;
  contents.emit("did-navigate", {}, "https://site.test/account", 200);
  assert.equal(store.history({}).length, 1);
});

test("device defaults belong to new tabs and fitting reserves reachable resize handles", () => {
  let enabled = false;
  const devices = new BrowserDevices(() => enabled);
  assert.equal(devices.get("old").enabled, false);
  enabled = true;
  const phone = devices.get("new");
  assert.equal(phone.enabled, true);
  assert.equal(devices.get("old").enabled, false);
  assert.throws(() => checkedViewport({ ...phone, width: -1 }));
  const panel = { x: 10, y: 20, width: 300, height: 420 },
    result = fitViewport(panel, phone);
  assert.ok(result.scale > 0 && result.scale < 1);
  assert.ok(result.bounds.x + result.bounds.width + 8 <= panel.x + panel.width);
  assert.ok(result.bounds.height + 8 <= panel.height);
  assert.equal(result.bounds.y, panel.y);
  const calls = [],
    view = {
      setBounds: (r) => calls.push(r),
      webContents: {
        enableDeviceEmulation: (o) => calls.push(o),
        disableDeviceEmulation: () => calls.push("clear"),
      },
    };
  devices.present("new", view, panel);
  assert.equal(calls.at(-1).viewSize.width, phone.width);
  devices.set("new", { ...phone, enabled: false });
  devices.present("new", view, panel);
  assert.equal(calls.at(-2), "clear");
});

test("privacy previews are single-use and never widen native categories to another time range", async (t) => {
  const store = new BrowserLibrary(":memory:");
  t.after(() => store.close());
  const now = Date.now();
  store.visit("https://old.test/", "", "test", now - 3 * 86400000);
  store.visit("https://new.test/", "", "test", now - 30);
  let clears = 0;
  const service = new BrowserPrivacy(
    store,
    { range: () => 0 },
    { cookies: { get: async () => [] }, getCacheSize: async () => 123, clearCache: async () => {} },
    () => ({ range: () => 0 }),
    async () => {
      clears++;
      throw new Error("site fixture failure");
    },
  );
  await assert.rejects(service.preview({ categories: ["sites", "history"], range: "hour" }));
  assert.equal(clears, 0);
  const recent = await service.preview({ categories: ["history"], range: "hour" });
  assert.equal(recent.counts.history, 1);
  assert.deepEqual(await service.apply(recent.token), { done: ["history"], failed: [] });
  await assert.rejects(service.apply(recent.token));
  assert.equal(store.history({})[0].url, "https://old.test/");
  const all = await service.preview({ categories: ["sites", "cache"], range: "all" });
  assert.equal(all.counts.cache, 123);
  assert.deepEqual(await service.apply(all.token), { done: ["cache"], failed: ["sites"] });
  assert.equal(clears, 1);
});

test("explicit password CSV supports quoted fields and rejects missing or broken headers", () => {
  const text =
    '\ufeffname,url,username,password,note\r\n"Writing, notes",https://example.test/,reader,"synthetic\n""quoted""",\r\n';
  assert.deepEqual(passwordCsv(text), [
    { name: "Writing, notes", url: "https://example.test/", username: "reader", password: 'synthetic\n"quoted"' },
  ]);
  assert.throws(() => passwordCsv("name,username\na,b"));
  assert.throws(() => passwordCsv('url,username,password\n"unterminated'));
});
