import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isMissingSessionFileError, resolveSessionDetailSource } = await jiti.import("./session-detail-source.ts");

test("uses a live manager when a session has not reached disk yet", async () => {
  const manager = {};
  let pathLookups = 0;
  const source = await resolveSessionDetailSource("session-live", {
    getLiveSession: () => ({
      isAlive: () => true,
      sessionFile: "planned-session.jsonl",
      inner: { sessionManager: manager },
    }),
    resolveSessionPath: async () => {
      pathLookups += 1;
      return "stale-cache-path.jsonl";
    },
    sessionFileExists: () => false,
  });

  assert.deepEqual(source, {
    kind: "memory",
    filePath: "planned-session.jsonl",
    manager,
  });
  assert.equal(pathLookups, 0, "an unpersisted live session must not touch the file path cache");
});

test("keeps persisted sessions on the existing file-backed path", async () => {
  const source = await resolveSessionDetailSource("session-file", {
    getLiveSession: () => ({
      isAlive: () => true,
      sessionFile: "session.jsonl",
      inner: { sessionManager: {} },
    }),
    resolveSessionPath: async () => "session.jsonl",
    sessionFileExists: () => true,
  });

  assert.deepEqual(source, { kind: "file", filePath: "session.jsonl" });
});

test("does not treat a dead unpersisted runtime as a readable memory session", async () => {
  const source = await resolveSessionDetailSource("session-dead", {
    getLiveSession: () => ({
      isAlive: () => false,
      sessionFile: "missing.jsonl",
      inner: { sessionManager: {} },
    }),
    resolveSessionPath: async () => "missing.jsonl",
    sessionFileExists: () => false,
  });

  assert.deepEqual(source, { kind: "file", filePath: "missing.jsonl" });
});

test("recognizes only ENOENT as a missing session file", () => {
  assert.equal(isMissingSessionFileError(Object.assign(new Error("missing"), { code: "ENOENT" })), true);
  assert.equal(isMissingSessionFileError(Object.assign(new Error("denied"), { code: "EACCES" })), false);
  assert.equal(isMissingSessionFileError(new Error("missing")), false);
});
