import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const {
  bindSessionAgentRuntimeProfile,
  parseAgentProfileStore,
  quarantineUnboundSessionFile,
  readAgentProfileStore,
  resolveSessionAgentRuntimeProfile,
  isSessionVisibleInAgentRuntimeProfile,
} = await import("./agent-profile-store.ts");

function tempStorePath(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-agent-profile-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "nested", "profiles.json");
}

test("profile storage fails closed on malformed or unsupported data", () => {
  assert.throws(() => parseAgentProfileStore("not-json"), (error) => error?.code === "INVALID_PROFILE_STORE");
  assert.throws(
    () => parseAgentProfileStore(JSON.stringify({ version: 2, sessions: {} })),
    (error) => error?.code === "INVALID_PROFILE_STORE",
  );
  assert.throws(
    () => parseAgentProfileStore(JSON.stringify({ version: 1, sessions: { s: { profile: "root", boundAt: "now" } } })),
    (error) => error?.code === "INVALID_PROFILE_STORE",
  );
});

test("bindings are immutable and concurrent writes preserve every session", async (t) => {
  const storePath = tempStorePath(t);
  await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      bindSessionAgentRuntimeProfile(`session-${index}`, "normal", storePath),
    ),
  );
  const store = readAgentProfileStore(storePath);
  assert.equal(Object.keys(store.sessions).length, 16);
  await assert.rejects(
    bindSessionAgentRuntimeProfile("session-3", "device-control", storePath),
    (error) => error?.code === "SESSION_PROFILE_MISMATCH",
  );
});

test("only normal mode may migrate a legacy unbound session", async (t) => {
  const normalPath = tempStorePath(t);
  assert.equal(await resolveSessionAgentRuntimeProfile("legacy", "normal", normalPath), "normal");
  assert.equal(readAgentProfileStore(normalPath).sessions.legacy.profile, "normal");

  const devicePath = tempStorePath(t);
  await assert.rejects(
    resolveSessionAgentRuntimeProfile("legacy", "device-control", devicePath),
    (error) => error?.code === "SESSION_PROFILE_MISSING",
  );
});

test("a stored device session migrates into the unified normal process", async (t) => {
  const storePath = tempStorePath(t);
  await bindSessionAgentRuntimeProfile("device-session", "device-control", storePath);
  assert.equal(await resolveSessionAgentRuntimeProfile("device-session", "normal", storePath), "normal");
  assert.equal(readAgentProfileStore(storePath).sessions["device-session"].profile, "normal");
});

test("unified normal runtime shows every existing session", () => {
  const store = parseAgentProfileStore(JSON.stringify({
    version: 1,
    sessions: {
      normal: { profile: "normal", boundAt: "2026-08-12T00:00:00.000Z" },
      device: { profile: "device-control", boundAt: "2026-08-12T00:00:00.000Z" },
    },
  }));
  assert.equal(isSessionVisibleInAgentRuntimeProfile("normal", "normal", store), true);
  assert.equal(isSessionVisibleInAgentRuntimeProfile("device", "normal", store), true);
  assert.equal(isSessionVisibleInAgentRuntimeProfile("legacy", "normal", store), true);
  assert.equal(isSessionVisibleInAgentRuntimeProfile("normal", "device-control", store), false);
  assert.equal(isSessionVisibleInAgentRuntimeProfile("device", "device-control", store), true);
  assert.equal(isSessionVisibleInAgentRuntimeProfile("legacy", "device-control", store), false);
});

test("a failed profile binding cannot leave a valid unbound session file", (t) => {
  const storePath = tempStorePath(t);
  const sessionPath = path.join(path.dirname(storePath), "new-session.jsonl");
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, '{"type":"session","id":"new-session"}\n', "utf8");
  quarantineUnboundSessionFile(sessionPath);
  assert.equal(fs.existsSync(sessionPath), false);
});
