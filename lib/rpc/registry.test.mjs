import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const registry = await jiti.import("./registry.ts");

function createStubSession(id, cwd, { alive = true, running = false } = {}) {
  let isAlive = alive;
  let destroyed = 0;
  let refreshedApprovals = 0;
  return {
    sessionId: id,
    cwd,
    projectRoot: cwd,
    runtimeProfile: "normal",
    inner: { sessionManager: { getHeader: () => null, getEntries: () => [], getSessionName: () => undefined } },
    isAlive: () => isAlive,
    isRunning: () => isAlive && running,
    isSubagentSession: () => false,
    destroy: () => {
      destroyed += 1;
      isAlive = false;
    },
    refreshToolApprovals: () => { refreshedApprovals += 1; },
    get destroyedCount() { return destroyed; },
    get refreshedApprovalsCount() { return refreshedApprovals; },
  };
}

test("registry tracks live sessions, busy cwds, starting cwds, and bulk cleanup", () => {
  const map = registry.getRegistry();
  const s1 = createStubSession("reg-test-1", process.cwd(), { running: true });
  const s2 = createStubSession("reg-test-2", process.cwd(), { running: false });
  map.set(s1.sessionId, s1);
  map.set(s2.sessionId, s2);
  try {
    assert.equal(registry.getRpcSession("reg-test-1"), s1);
    assert.equal(registry.hasBusyRpcSessionForCwd(process.cwd()), true);

    registry.refreshLiveToolApprovals();
    assert.equal(s1.refreshedApprovalsCount, 1);
    assert.equal(s2.refreshedApprovalsCount, 1);

    const destroyed = registry.destroyRpcSessionsForCwd(process.cwd());
    assert.ok(destroyed >= 2);
    assert.equal(s1.destroyedCount, 1);
    assert.equal(s2.destroyedCount, 1);
    assert.equal(registry.hasBusyRpcSessionForCwd(process.cwd()), false);

    const releaseStart = registry.trackStartingSession(process.cwd());
    assert.equal(registry.hasBusyRpcSessionForCwd(process.cwd()), true);
    releaseStart();
    assert.equal(registry.hasBusyRpcSessionForCwd(process.cwd()), false);
  } finally {
    map.delete(s1.sessionId);
    map.delete(s2.sessionId);
  }
});

test("invalidateServicesCache clears cached session service entries", () => {
  const cache = registry.getServicesCache();
  cache.set("normal:test-cache-key", { settingsManager: {} });
  assert.equal(cache.has("normal:test-cache-key"), true);
  registry.invalidateServicesCache();
  assert.equal(cache.size, 0);
});
