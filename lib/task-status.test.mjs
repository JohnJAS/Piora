import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  STATUS_PRESENTATION,
  createRunningSessionsPayload,
  deriveTaskStatus,
  getTaskStatusPresentationKey,
} = await jiti.import("./task-status.ts");

function input(overrides = {}) {
  return {
    sessionId: "session-a",
    runningIds: new Set(),
    compactingIds: new Set(),
    pendingApprovalIds: new Set(),
    lastPromptFailed: false,
    hasUnreadResult: false,
    archived: false,
    isViewing: false,
    ...overrides,
  };
}

test("derives lifecycle and runtime axes independently", () => {
  assert.deepEqual(deriveTaskStatus(input()), {
    lifecycle: "active",
    runtime: "idle",
    attention: "none",
  });
  assert.equal(deriveTaskStatus(input({ sessionId: "" })).lifecycle, "draft");
  assert.equal(deriveTaskStatus(input({ archived: true })).lifecycle, "archived");
  assert.equal(deriveTaskStatus(input({ runningIds: new Set(["session-a"]) })).runtime, "running");
  assert.equal(deriveTaskStatus(input({
    runningIds: new Set(["session-a"]),
    compactingIds: new Set(["session-a"]),
  })).runtime, "compacting");
});

test("applies attention priority and clears attention while viewing", () => {
  const conflicted = input({
    pendingApprovalIds: new Set(["session-a"]),
    lastPromptFailed: true,
    hasUnreadResult: true,
  });
  assert.equal(deriveTaskStatus(conflicted).attention, "needs_approval");
  assert.equal(deriveTaskStatus(input({ lastPromptFailed: true, hasUnreadResult: true })).attention, "failed");
  assert.equal(deriveTaskStatus(input({ hasUnreadResult: true })).attention, "unread");
  assert.equal(deriveTaskStatus({ ...conflicted, isViewing: true }).attention, "none");
});

test("keeps one shared presentation map for runtime and attention states", () => {
  assert.equal(STATUS_PRESENTATION.running.colorVar, "--status-running");
  assert.equal(STATUS_PRESENTATION.needs_approval.colorVar, "--status-attention");
  assert.equal(STATUS_PRESENTATION.needs_input.colorVar, "--status-attention");
  assert.equal(STATUS_PRESENTATION.failed.colorVar, "--status-failed");
  assert.equal(STATUS_PRESENTATION.unread.colorVar, "--status-ready");
  assert.equal(getTaskStatusPresentationKey(deriveTaskStatus(input({ hasUnreadResult: true }))), "unread");
  assert.equal(getTaskStatusPresentationKey(deriveTaskStatus(input({ runningIds: new Set(["session-a"]) }))), "running");
});

test("builds the expanded payload without removing the legacy running id field", () => {
  const payload = createRunningSessionsPayload([
    { id: "run", runtime: "running", pendingApproval: false, lastPromptFailed: false },
    { id: "failed", runtime: "idle", pendingApproval: false, lastPromptFailed: true },
  ]);
  assert.deepEqual(payload.runningSessionIds, ["run"]);
  assert.equal(payload.runningSessions.length, 2);
});
