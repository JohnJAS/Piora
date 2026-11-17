import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
const { BrowserPreferences, browserDownloadPath, browserFontPreferences } = await createJiti(import.meta.url).import("../desktop/src/browser-preferences.ts");

test("download preferences apply immediately, persist, reset and reject unusable destinations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-browser-prefs-"));
  try {
    const file = path.join(root, "profile", "browser.json"), fallback = path.join(root, "Downloads"), custom = path.join(root, "中文 Files");
    const prefs = new BrowserPreferences(file), applied = [];
    assert.deepEqual(prefs.downloads(fallback), { directory: "", askEachTime: false, effectiveDirectory: fallback });
    prefs.updateDownloads({ directory: custom, askEachTime: true }, fallback, value => applied.push(value));
    assert.deepEqual(applied, [custom]);
    const restored = new BrowserPreferences(file);
    assert.deepEqual(restored.downloads(fallback), { directory: custom, askEachTime: true, effectiveDirectory: custom });
    for (const directory of ["relative", "../outside", "bad\npath"]) assert.throws(() => restored.updateDownloads({ directory, askEachTime: false }, fallback, () => assert.fail("must not apply invalid paths")));
    const regular = path.join(root, "a.txt"); await writeFile(regular, "test");
    assert.throws(() => restored.updateDownloads({ directory: regular, askEachTime: false }, fallback, () => assert.fail("must not apply regular files")));
    assert.equal(restored.downloads(fallback).directory, custom);
    restored.updateDownloads({ directory: "", askEachTime: false }, fallback, value => applied.push(value));
    assert.equal(applied.at(-1), fallback);
    assert.equal(new BrowserPreferences(file).downloads(fallback).directory, "");
    const broken = new BrowserPreferences(path.join(regular, "blocked.json"));
    const rollback = [];
    assert.throws(() => broken.updateDownloads({ directory: custom, askEachTime: true }, fallback, value => rollback.push(value)));
    assert.deepEqual(rollback, [custom, fallback], "failed persistence restores the live session path");
    assert.equal(broken.downloads(fallback).directory, "");
    const failedApply = new BrowserPreferences(file);
    const before = await readFile(file, "utf8");
    assert.throws(() => failedApply.updateDownloads({ directory: custom, askEachTime: true }, fallback, () => { throw Error("session denied"); }));
    assert.equal(await readFile(file, "utf8"), before);
  } finally { assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
});

test("site zoom survives reload, isolates origins, clamps range and resets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-browser-zoom-"));
  try {
    const file = path.join(root, "browser.json"), preferences = new BrowserPreferences(file);
    preferences.setZoomLevel("https://a.example/path", 0.5);
    const restored = new BrowserPreferences(file);
    assert.equal(restored.zoomLevel("https://a.example/another?x=1"), 0.5);
    for (const other of ["http://a.example/", "https://b.example/", "https://a.example:8443", "about:blank"]) assert.equal(restored.zoomLevel(other), 0);
    assert.equal(restored.setZoomLevel("https://a.example", 100), 5);
    assert.equal(restored.setZoomLevel("https://b.example", -100), -3);
    restored.setZoomLevel("https://a.example", 0);
    assert.equal(new BrowserPreferences(file).zoomLevel("https://a.example"), 0);
    assert.equal(restored.setZoomLevel("file:///tmp/private", 1), 0);
    assert.equal(restored.setZoomLevel("https://a.example", NaN), 0);
  } finally { assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
});

test("download filenames stay inside the selected folder and avoid existing and concurrent names", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-browser-download-"));
  try {
    await mkdir(path.join(root, "folder"));
    const destination = path.join(root, "folder");
    await writeFile(path.join(destination, "报告.txt"), "original");
    const reserved = new Set([path.join(destination, "报告 (1).txt")]);
    assert.equal(browserDownloadPath(destination, "../../报告.txt", reserved), path.join(destination, "报告 (2).txt"));
    for (const filename of ["..\\..\\escape.txt", "..", "NUL.txt", "<bad>:file.txt"]) assert.equal(path.dirname(browserDownloadPath(destination, filename)), destination);
    assert.equal(await readFile(path.join(destination, "报告.txt"), "utf8"), "original");
    assert.equal(browserFontPreferences("win32").defaultFontFamily.monospace, "Consolas");
    assert.equal(browserFontPreferences("win32").minimumFontSize, 0, "page CSS keeps control over its font size");
  } finally { assert.equal(path.dirname(root), path.resolve(tmpdir())); await rm(root, { recursive: true, force: true }); }
});
