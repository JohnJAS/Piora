import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  TASK_PLAN_SCHEMA_VERSION,
  TASK_RUN_SCHEMA_VERSION,
  projectTaskRun,
  projectRoomTaskRun,
  reduceTaskRunEvent,
  replayTaskRun,
} = await jiti.import("./task-run.ts");

function event(type, details = {}, at = 1) {
  return {
    schemaVersion: TASK_RUN_SCHEMA_VERSION,
    eventId: `${type}-${at}`,
    taskId: "task-1",
    at,
    type,
    ...details,
  };
}

test("replays a planned, approved, verified TaskRun without mutating prior states", () => {
  const created = reduceTaskRunEvent(undefined, event("created", {
    source: "session",
    sessionId: "session-1",
    objective: "Implement the unified runtime",
  }));
  const planned = reduceTaskRunEvent(created, event("planned", {
    plan: {
      schemaVersion: TASK_PLAN_SCHEMA_VERSION,
      id: "plan-1",
      objective: "Implement and verify the unified runtime",
      assumptions: [],
      successCriteria: ["Focused tests pass"],
      steps: [{ id: "step-1", title: "Implement", dependsOn: [], status: "pending" }],
      createdAt: 2,
      updatedAt: 2,
    },
  }, 2));
  const waiting = reduceTaskRunEvent(planned, event("approval_requested", { reason: "Approve execution" }, 3));
  const running = reduceTaskRunEvent(waiting, event("started", { operationId: "run-1" }, 4));
  const verifying = reduceTaskRunEvent(running, event("verification_started", {}, 5));
  const withEvidence = reduceTaskRunEvent(verifying, event("evidence_added", {
    evidence: { id: "evidence-1", kind: "verification", summary: "Tests passed", createdAt: 6 },
  }, 6));
  const completed = reduceTaskRunEvent(withEvidence, event("completed", { summary: "Verified" }, 7));

  assert.equal(created.phase, "draft");
  assert.equal(planned.phase, "planned");
  assert.equal(waiting.phase, "waiting_approval");
  assert.equal(running.attempt, 1);
  assert.equal(completed.phase, "completed");
  assert.equal(completed.evidence.length, 1);
  assert.equal(completed.finishedAt, 7);
});

test("rejects illegal terminal transitions and cross-task events", () => {
  const completed = replayTaskRun([
    event("created", { source: "session", objective: "Do work" }),
    event("started", {}, 2),
    event("completed", { summary: "Done" }, 3),
  ]);
  assert.ok(completed);
  assert.throws(
    () => reduceTaskRunEvent(completed, event("started", {}, 4)),
    /Cannot start TaskRun/,
  );
  assert.throws(
    () => reduceTaskRunEvent(completed, { ...event("progressed", { progress: "late" }, 5), taskId: "other" }),
    /different task/,
  );
});

test("projects ordinary live prompts and omits clean idle sessions", () => {
  assert.equal(projectTaskRun({
    sessionId: "idle",
    runtime: "idle",
    pendingApproval: false,
    lastPromptFailed: false,
  }), undefined);

  const active = projectTaskRun({
    sessionId: "active",
    runtime: "running",
    pendingApproval: false,
    lastPromptFailed: false,
    startedAt: 100,
    title: "Fix the parser",
    activity: { message: "Running focused tests", updatedAt: 120 },
  });
  assert.equal(active?.phase, "running");
  assert.equal(active?.objective, "Fix the parser");
  assert.equal(active?.progress, "Running focused tests");
});

test("projects Room lease, completion, failure, and artifacts without changing Room ownership", () => {
  const base = {
    schemaVersion: 1,
    id: "room-task-1",
    roomId: "room-1",
    title: "Implement parser",
    description: "Implement and test the parser",
    status: "leased",
    priority: 0,
    createdBy: "coordinator",
    assignedTo: "worker-1",
    dependsOn: [],
    attempt: 1,
    maxAttempts: 3,
    createdAt: 10,
    updatedAt: 20,
    lease: {
      holderSessionId: "worker-1",
      token: "lease-1",
      acquiredAt: 15,
      heartbeatAt: 20,
      expiresAt: 100,
    },
  };
  const leased = projectRoomTaskRun(base);
  assert.equal(leased.source, "room");
  assert.equal(leased.phase, "running");
  assert.equal(leased.operationId, "room-task-1:attempt:1");
  assert.equal(JSON.stringify(leased).includes("lease-1"), false);

  const completed = projectRoomTaskRun({
    ...base,
    status: "completed",
    lease: undefined,
    result: "Parser tests passed",
    updatedAt: 30,
  }, [{
    schemaVersion: 1,
    id: "artifact-1",
    roomId: "room-1",
    sessionId: "worker-1",
    taskId: "room-task-1",
    kind: "commit",
    name: "abc123",
    summary: "Verified parser implementation",
    createdAt: 29,
  }]);
  assert.equal(completed.phase, "completed");
  assert.equal(completed.progress, "Parser tests passed");
  assert.equal(completed.artifacts[0].id, "artifact-1");
  assert.equal(completed.finishedAt, 30);

  const failed = projectRoomTaskRun({
    ...base,
    status: "failed",
    lease: undefined,
    error: "Tests failed",
    updatedAt: 31,
  });
  assert.equal(failed.phase, "failed");
  assert.equal(failed.reason, "Tests failed");
});
