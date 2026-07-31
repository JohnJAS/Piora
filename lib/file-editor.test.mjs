import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  TEXT_EDIT_MAX_BYTES,
  TextFileEditError,
  getTextFileVersion,
  readTextFileSnapshot,
  resolveWritableTextFilePath,
  saveTextFileAtomic,
} = await jiti.import("./file-editor.ts");

function createTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-editor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("reads UTF-8 text with a stable SHA-256 version and mtime", (t) => {
  const root = createTempRoot(t);
  const filePath = path.join(root, "hello.txt");
  const bytes = Buffer.from("hello 世界\n", "utf8");
  fs.writeFileSync(filePath, bytes);

  const snapshot = readTextFileSnapshot(filePath);
  assert.equal(snapshot.content, "hello 世界\n");
  assert.equal(snapshot.size, bytes.byteLength);
  assert.equal(snapshot.version, getTextFileVersion(bytes));
  assert.match(snapshot.version, /^[a-f0-9]{64}$/);
  assert.equal(Number.isNaN(Date.parse(snapshot.mtime)), false);
});

test("saves atomically, preserves permissions, and detects stale versions", async (t) => {
  const root = createTempRoot(t);
  const filePath = path.join(root, "edit.txt");
  fs.writeFileSync(filePath, "original", { mode: 0o640 });
  const original = readTextFileSnapshot(filePath);

  const saved = await saveTextFileAtomic(filePath, "first save", original.version);
  assert.equal(saved.status, "saved");
  assert.equal(saved.snapshot.content, "first save");
  assert.equal(fs.readFileSync(filePath, "utf8"), "first save");
  assert.deepEqual(fs.readdirSync(root), ["edit.txt"]);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o640);
  }

  const conflict = await saveTextFileAtomic(filePath, "stale write", original.version);
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.current.version, saved.snapshot.version);
  assert.equal(fs.readFileSync(filePath, "utf8"), "first save");

  const forced = await saveTextFileAtomic(filePath, "forced write", original.version, true);
  assert.equal(forced.status, "saved");
  assert.equal(forced.snapshot.content, "forced write");
});

test("authorizes only regular files that resolve inside an allowed root", (t) => {
  const base = createTempRoot(t);
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  const insideFile = path.join(allowed, "inside.txt");
  const outsideFile = path.join(outside, "outside.txt");
  fs.writeFileSync(insideFile, "inside");
  fs.writeFileSync(outsideFile, "outside");
  const roots = new Set([allowed]);

  assert.equal(resolveWritableTextFilePath(insideFile, roots), fs.realpathSync(insideFile));
  assert.throws(
    () => resolveWritableTextFilePath(outsideFile, roots),
    (error) => error instanceof TextFileEditError && error.code === "FILE_ACCESS_DENIED",
  );

  const escapedDirectory = path.join(allowed, "escaped");
  fs.symlinkSync(outside, escapedDirectory, process.platform === "win32" ? "junction" : "dir");
  assert.throws(
    () => resolveWritableTextFilePath(path.join(escapedDirectory, "outside.txt"), roots),
    (error) => error instanceof TextFileEditError && error.code === "FILE_ACCESS_DENIED",
  );

  const link = path.join(allowed, "link.txt");
  try {
    fs.symlinkSync(outsideFile, link, "file");
    assert.throws(
      () => resolveWritableTextFilePath(link, roots),
      (error) => error instanceof TextFileEditError && error.code === "FILE_NOT_REGULAR",
    );
  } catch (error) {
    // Windows without Developer Mode cannot create file symlinks. The junction
    // assertion above still covers resolved-path escape prevention.
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
  }

  assert.throws(
    () => resolveWritableTextFilePath(allowed, roots),
    (error) => error instanceof TextFileEditError && error.code === "FILE_NOT_REGULAR",
  );
});

test("rejects binary, NUL-containing, and oversized text", async (t) => {
  const root = createTempRoot(t);
  const binaryPath = path.join(root, "binary.txt");
  fs.writeFileSync(binaryPath, Buffer.from([0xff, 0xfe]));
  assert.throws(
    () => readTextFileSnapshot(binaryPath),
    (error) => error instanceof TextFileEditError && error.code === "FILE_NOT_UTF8_TEXT",
  );

  const nulPath = path.join(root, "nul.txt");
  fs.writeFileSync(nulPath, "left\0right");
  assert.throws(
    () => readTextFileSnapshot(nulPath),
    (error) => error instanceof TextFileEditError && error.code === "FILE_NOT_UTF8_TEXT",
  );

  const normalPath = path.join(root, "normal.txt");
  fs.writeFileSync(normalPath, "ok");
  const original = readTextFileSnapshot(normalPath);
  await assert.rejects(
    () => saveTextFileAtomic(normalPath, "x".repeat(TEXT_EDIT_MAX_BYTES + 1), original.version),
    (error) => error instanceof TextFileEditError && error.code === "FILE_TOO_LARGE",
  );
  assert.equal(fs.readFileSync(normalPath, "utf8"), "ok");
});
