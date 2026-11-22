import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getRunningRpcSessionIds, getRunningRpcSessionStatuses } = await jiti.import("./rpc-running-status.ts");
const { createRunningSessionsPayload } = await jiti.import("./task-status.ts");

function fakeWrapper(snapshot, options = {}) {
  return {
    sessionId: snapshot.id,
    isAlive: () => options.alive ?? true,
    isSubagentSession: () => Boolean(options.subagent),
    isSideConversation: () => Boolean(options.sideParentId),
    getSideChatParentId: () => options.sideParentId ?? null,
    isRunning: () => snapshot.runtime === "running",
    inner: { isCompacting: snapshot.runtime === "compacting" },
    getTaskRuntimeSnapshot: () => snapshot,
  };
}

test("getRunningRpcSessionStatuses retains idle sessions with activeGoal or awaitingPlanApproval while excluding plain idle sessions", () => {
  const previous = globalThis.__piSessions;
  const mockSessions = new Map([
    [
      "plain-idle",
      fakeWrapper({
        id: "plain-idle",
        runtime: "idle",
        pendingApproval: false,
        lastPromptFailed: false,
      }),
    ],
    [
      "idle-goal",
      fakeWrapper({
        id: "idle-goal",
        runtime: "idle",
        pendingApproval: false,
        lastPromptFailed: false,
        activeGoal: true,
      }),
    ],
    [
      "idle-plan",
      fakeWrapper({
        id: "idle-plan",
        runtime: "idle",
        pendingApproval: false,
        lastPromptFailed: false,
        awaitingPlanApproval: true,
      }),
    ],
    [
      "running-goal",
      fakeWrapper({
        id: "running-goal",
        runtime: "running",
        pendingApproval: false,
        lastPromptFailed: false,
        activeGoal: true,
      }),
    ],
  ]);

  globalThis.__piSessions = mockSessions;
  try {
    const filtered = getRunningRpcSessionStatuses(false);
    assert.deepEqual(filtered.map((s) => s.id), ["idle-goal", "idle-plan", "running-goal"]);
    assert.equal(filtered.find((s) => s.id === "idle-goal")?.activeGoal, true);
    assert.equal(filtered.find((s) => s.id === "idle-plan")?.awaitingPlanApproval, true);
    assert.deepEqual(getRunningRpcSessionIds(), ["running-goal"]);

    const withAllIdle = getRunningRpcSessionStatuses(true);
    assert.deepEqual(withAllIdle.map((s) => s.id), ["idle-goal", "idle-plan", "plain-idle", "running-goal"]);

    const payload = createRunningSessionsPayload(filtered);
    assert.deepEqual(payload.runningSessionIds, ["running-goal"]);
    assert.deepEqual(payload.runningSessions.map((s) => s.id), ["idle-goal", "idle-plan", "running-goal"]);
  } finally {
    globalThis.__piSessions = previous;
  }
});
