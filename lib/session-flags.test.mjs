import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const {
  applySessionFlagPatch,
  parseSessionFlags,
  readSessionFlags,
  updateSessionFlag,
} = await import("./session-flags.ts");

function tempFlagsPath(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-session-flags-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "nested", "session-flags.json");
}

test("parses only supported flag fields and tolerates malformed storage", () => {
  assert.deepEqual(parseSessionFlags("not json"), {});
  assert.deepEqual(parseSessionFlags(JSON.stringify({ a: { pinned: true, extra: 1 }, b: null })), {
    a: { pinned: true },
  });
});

test("pin timestamps are stable until a session is unpinned and pinned again", () => {
  const first = applySessionFlagPatch({}, "a", { pinned: true }, "2026-01-01T00:00:00.000Z");
  const second = applySessionFlagPatch(first, "a", { pinned: true }, "2026-02-01T00:00:00.000Z");
  assert.equal(second.a.pinnedAt, "2026-01-01T00:00:00.000Z");
  const third = applySessionFlagPatch(second, "a", { pinned: false });
  assert.equal(third.a.pinnedAt, undefined);
});

test("concurrent writes preserve every session", async (t) => {
  const flagsPath = tempFlagsPath(t);
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      updateSessionFlag(`session-${index}`, { pinned: index % 2 === 0, archived: index % 3 === 0 }, flagsPath),
    ),
  );
  const flags = readSessionFlags(flagsPath);
  assert.equal(Object.keys(flags).length, 24);
  assert.equal(flags["session-6"].pinned, true);
  assert.equal(flags["session-6"].archived, true);
});
