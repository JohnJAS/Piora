import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveUploadFiles, uploadPlaywrightFiles } = await jiti.import("./browser-upload.ts");
const { captureFileChooser, FILE_CHOOSER_TIMEOUT_MS } = await jiti.import("../desktop/src/browser-agent-logic.ts");
const url = "https://upload.example.test/attachments";
const files = ["file one.txt", "第二份.txt"];

test("upload paths preserve Unicode and spaces and resolve relative paths against the session cwd", async t => {
  const cwd = await mkdtemp(join(tmpdir(), "piora-upload-paths-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const paths = files.map(name => join(cwd, name));
  await Promise.all(paths.map(path => writeFile(path, "upload")));
  assert.deepEqual(await resolveUploadFiles([files[0], paths[1]], cwd), paths);
  await assert.rejects(resolveUploadFiles([files[0], "missing.txt"], cwd), /missing\.txt/);
  await assert.rejects(resolveUploadFiles([cwd], cwd), /not an accessible file/);
  for (const malformed of [undefined, [], "file.txt", [2], ["  "], ["nul\0.txt"]]) {
    await assert.rejects(resolveUploadFiles(malformed, cwd), /requires at least one local file path/);
  }
});

function playwrightFixture({ fileInput = true, disabled = false } = {}) {
  const page = new EventEmitter();
  const mainFrame = {};
  page.mainFrame = () => mainFrame;
  page.url = () => url;
  const events = [];
  const chooserInput = { async dispose() { events.push("dispose chooser input"); } };
  const chooser = {
    async setFiles(selected) { events.push(["chooser", selected]); },
    element() { return chooserInput; },
  };
  const target = {
    async evaluate() { return { fileInput, disabled }; },
    async click() { events.push("click"); page.emit("filechooser", chooser); },
    async setInputFiles(selected) { events.push(["input", selected]); },
    async dispose() { events.push("dispose target"); },
  };
  const locator = { async elementHandle() { return target; } };
  return { page, mainFrame, locator, target, chooser, events };
}

function assertListenersRemoved(page) {
  assert.equal(page.listenerCount("filechooser"), 0);
  assert.equal(page.listenerCount("framenavigated"), 0);
}

test("background upload sets the input directly and releases the handle", async () => {
  const { page, locator, events } = playwrightFixture();
  await uploadPlaywrightFiles(page, locator, url, files);
  assert.deepEqual(events, [["input", files], "dispose target"]);
  assertListenersRemoved(page);
});

test("background upload captures a file picker from the click and sets exactly the requested files", async () => {
  const { page, locator, events } = playwrightFixture({ fileInput: false });
  await uploadPlaywrightFiles(page, locator, url, files);
  assert.deepEqual(events, ["click", ["chooser", files], "dispose chooser input", "dispose target"]);
  assertListenersRemoved(page);
});

test("background upload refuses a different URL or a disabled control before interacting", async () => {
  const { page, locator, events } = playwrightFixture({ disabled: true });
  await assert.rejects(uploadPlaywrightFiles(page, locator, url + "?wrong", files), /upload page changed/i);
  assert.deepEqual(events, []);
  await assert.rejects(uploadPlaywrightFiles(page, locator, url, files), /upload control is disabled/i);
  assert.deepEqual(events, ["dispose target"]);
  assertListenersRemoved(page);
});

test("background upload refuses a chooser after a main frame reload even at the same URL", async () => {
  const { page, mainFrame, locator, target, chooser, events } = playwrightFixture({ fileInput: false });
  target.click = async () => {
    page.emit("framenavigated", mainFrame);
    page.emit("filechooser", chooser);
  };
  await assert.rejects(uploadPlaywrightFiles(page, locator, url, files), /upload page changed/i);
  assert.deepEqual(events, ["dispose chooser input", "dispose target"]);
  assertListenersRemoved(page);
});

test("background upload cleans up after cancellation or a site click error", async () => {
  const { page, locator, target, events } = playwrightFixture({ fileInput: false });
  const controller = new AbortController();
  target.click = async () => controller.abort();
  await assert.rejects(uploadPlaywrightFiles(page, locator, url, files, controller.signal), /aborted/i);
  assertListenersRemoved(page);
  target.click = async () => { throw new Error("click failed"); };
  await assert.rejects(uploadPlaywrightFiles(page, locator, url, files), /click failed/);
  assert.deepEqual(events, ["dispose target", "dispose target"]);
  assertListenersRemoved(page);
});

test("background upload reports file assignment failure and still releases both handles", async () => {
  const { page, locator, chooser, events } = playwrightFixture({ fileInput: false });
  chooser.setFiles = async () => { throw new Error("Non-multiple file input can only accept single file"); };
  await assert.rejects(uploadPlaywrightFiles(page, locator, url, files), /only accept single file/);
  assert.deepEqual(events, ["click", "dispose chooser input", "dispose target"]);
  assertListenersRemoved(page);
});

test("chooser wait times out and unsubscribes when the page opens no picker", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let listening = false;
  const selected = captureFileChooser(
    () => { listening = true; return () => { listening = false; }; },
    async () => { assert.equal(listening, true); },
  );
  const timeout = assert.rejects(selected, /no file picker opened/i);
  await Promise.resolve();
  t.mock.timers.tick(FILE_CHOOSER_TIMEOUT_MS);
  await timeout;
  assert.equal(listening, false);
});
