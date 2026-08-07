import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Isolate the trash root under a temp dir by pointing the SDK's agent dir at
// it (getAgentDir reads PI_CODING_AGENT_DIR on every call).
const sandbox = mkdtempSync(join(tmpdir(), "pi-trash-test-"));
process.env.PI_CODING_AGENT_DIR = sandbox;

const jiti = createJiti(import.meta.url);
const {
  getTrashRoot,
  trashSession,
  restoreSession,
  purgeExpiredTrash,
  readTrashManifest,
  TRASH_UNDO_WINDOW_MS,
} = await jiti.import("./session-trash.ts");

function makeSessionFile(dir, name, parentSession) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  const header = { type: "session", version: 3, id: name.slice(0, 8), timestamp: "2026-01-01T00:00:00.000Z", cwd: dir };
  if (parentSession) header.parentSession = parentSession;
  writeFileSync(file, `${JSON.stringify(header)}\n{"type":"message"}\n`, "utf8");
  return file;
}

test("trash root lives outside the sessions tree and resolves to a temp agent dir", () => {
  assert.equal(getTrashRoot(), join(sandbox, "trash", "sessions"));
});

test("trashSession moves the whole subtree and writes a manifest before any move", () => {
  const dir = join(sandbox, "sessions", "project-a");
  const root = makeSessionFile(dir, "10000000_aaa.jsonl");
  const child = makeSessionFile(dir, "10000001_bbb.jsonl", root);

  const manifest = trashSession("id-1", [root, child]);
  assert.equal(manifest.entries.length, 2);
  assert.ok(readTrashManifest("id-1"), "manifest survives the move");
  assert.ok(!existsSync(root), "root no longer at original path");
  assert.ok(!existsSync(child), "child no longer at original path");
  assert.ok(manifest.entries.every((entry) => existsSync(entry.trashed)), "every file exists in trash");
});

test("restoreSession moves every file back and clears the manifest", () => {
  const dir = join(sandbox, "sessions", "project-b");
  const root = makeSessionFile(dir, "20000000_aaa.jsonl");
  const child = makeSessionFile(dir, "20000001_bbb.jsonl", root);

  trashSession("id-2", [root, child]);
  assert.equal(restoreSession("id-2"), true);
  assert.ok(existsSync(root), "root restored");
  assert.ok(existsSync(child), "child restored");
  // Content intact, including the child's parentSession link to the root path
  // (JSON-escaped on disk, so compare against the escaped form).
  assert.ok(readFileSync(child, "utf8").includes(JSON.stringify(root).slice(1, -1)), "parentSession link preserved");
  assert.equal(readTrashManifest("id-2"), null, "manifest removed");
});

test("restore of an unknown or purged session returns false", () => {
  assert.equal(restoreSession("does-not-exist"), false);
});

test("purgeExpiredTrash removes files past the undo window and keeps fresh ones", () => {
  const dir = join(sandbox, "sessions", "project-c");
  const fresh = makeSessionFile(dir, "30000000_fresh.jsonl");
  const stale = makeSessionFile(dir, "30000001_stale.jsonl");

  trashSession("fresh", [fresh]);
  // Simulate an old manifest by rewriting its timestamp.
  const manifestPath = join(getTrashRoot(), "fresh.manifest.json");
  const staleManifest = {
    id: "stale",
    trashedAt: Date.now() - TRASH_UNDO_WINDOW_MS - 1,
    entries: [{ original: stale, trashed: join(getTrashRoot(), "stale", "f.jsonl") }],
  };
  writeFileSync(manifestPath, JSON.stringify(staleManifest));
  mkdirSync(join(getTrashRoot(), "stale"), { recursive: true });
  writeFileSync(staleManifest.entries[0].trashed, "stale-content");

  purgeExpiredTrash(TRASH_UNDO_WINDOW_MS);
  assert.ok(readTrashManifest("fresh"), "fresh session keeps its manifest");
  assert.equal(readTrashManifest("stale"), null, "stale manifest swept");
  assert.ok(!existsSync(staleManifest.entries[0].trashed), "stale files removed");
});

test.after(() => {
  rmSync(sandbox, { recursive: true, force: true });
  delete process.env.PI_CODING_AGENT_DIR;
});
