import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const reducer = await jiti.import("./team-run-reducer.ts");

const roomId = randomUUID();
const runId = randomUUID();
const coordinatorId = "coordinator";
const workerId = "worker";
const reviewerId = "reviewer";

function envelope(cursor, event, actor = { kind: "system", id: "piora" }) {
  return { schemaVersion: 1, id: randomUUID(), cursor, roomId, teamRunId: runId, at: 1_000 + cursor, actor, event };
}

function task(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "implementation",
    teamRunId: runId,
    title: "Implement feature",
    description: "Implement the requested feature.",
    acceptanceCriteria: ["Tests pass"],
    requiredCapabilities: ["implementation"],
    dependsOn: [],
    priority: 1,
    status: "pending",
    assignmentMode: "auto",
    attempt: 0,
    maxAttempts: 3,
    reviewPolicy: { required: true, reviewerMemberIds: [reviewerId], minimumApprovals: 1 },
    reviewRound: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function plan(tasks) {
  return {
    schemaVersion: 1,
    revision: 1,
    objective: "Ship a verified feature",
    assumptions: [],
    successCriteria: [],
    taskIds: tasks.map((item) => item.id),
    submittedByMemberId: coordinatorId,
    createdAt: 1_001,
    updatedAt: 1_001,
  };
}

function dispatch(taskId, attempt = 1, purpose = "task", memberId = workerId) {
  return {
    dispatchId: randomUUID(),
    purpose,
    taskId,
    memberId,
    sessionId: `${memberId}-session`,
    attempt,
    leaseTokenHash: "hash",
    status: "requested",
    requestedAt: 1_000,
    updatedAt: 1_000,
  };
}

function plannedState(tasks = [task()]) {
  const planning = dispatch("__planning__", 1, "planning", coordinatorId);
  return reducer.replayTeamRunEvents([
    envelope(1, { type: "run.created", objective: "Ship a verified feature", coordinatorMemberId: coordinatorId }),
    envelope(2, { type: "planning.requested", dispatch: planning }),
    envelope(3, { type: "plan.submitted", plan: plan(tasks), tasks }),
    envelope(4, { type: "run.started" }),
  ]);
}

test("validateTeamPlan accepts a DAG and rejects cycles, unknown dependencies, and empty criteria", () => {
  const first = task({ id: "a", reviewPolicy: { required: false, reviewerMemberIds: [], minimumApprovals: 0 } });
  const second = task({ id: "b", dependsOn: ["a"], reviewPolicy: { required: false, reviewerMemberIds: [], minimumApprovals: 0 } });
  const room = { members: [coordinatorId, workerId, reviewerId].map((memberId) => ({ memberId })) };
  assert.deepEqual(reducer.validateTeamPlan(plan([first, second]), room, [first, second], runId).topologicalTaskIds, ["a", "b"]);
  assert.throws(() => reducer.validateTeamPlan(plan([{ ...first, dependsOn: ["b"] }, { ...second, dependsOn: ["a"] }]), room, [{ ...first, dependsOn: ["b"] }, { ...second, dependsOn: ["a"] }], runId), /cycle/);
  assert.throws(() => reducer.validateTeamPlan(plan([{ ...first, dependsOn: ["missing"] }]), room, [{ ...first, dependsOn: ["missing"] }], runId), /unknown dependency/);
  assert.throws(() => reducer.validateTeamPlan(plan([{ ...first, acceptanceCriteria: [] }]), room, [{ ...first, acceptanceCriteria: [] }], runId), /acceptance criteria/);
});

test("reducer enforces contiguous cursors, event identity, dependencies, and terminal immutability", () => {
  const first = task({ id: "first", reviewPolicy: { required: false, reviewerMemberIds: [], minimumApprovals: 0 } });
  const second = task({ id: "second", dependsOn: ["first"], reviewPolicy: { required: false, reviewerMemberIds: [], minimumApprovals: 0 } });
  const state = plannedState([first, second]);
  assert.deepEqual(reducer.deriveReadyTaskIds(state), ["first"]);
  assert.throws(() => reducer.reduceTeamRunEvent(state, envelope(6, { type: "task.ready", taskId: "first" })), /cursor/);
  assert.throws(() => reducer.reduceTeamRunEvent(state, { ...envelope(5, { type: "task.ready", taskId: "first" }), roomId: randomUUID() }), /identity/);
  assert.throws(() => reducer.reduceTeamRunEvent(state, envelope(5, { type: "task.ready", taskId: "second" })), /dependencies/);

  const failed = reducer.reduceTeamRunEvent(state, envelope(5, { type: "run.failed", reason: "fatal" }));
  assert.equal(failed.phase, "failed");
  assert.throws(() => reducer.reduceTeamRunEvent(failed, envelope(6, { type: "run.progressed", summary: "late" })), (error) => error.code === "TEAM_ALREADY_TERMINAL");
});

test("code task completion requires structured runtime evidence and an independent approval", () => {
  let state = plannedState();
  state = reducer.reduceTeamRunEvent(state, envelope(5, { type: "task.ready", taskId: "implementation" }));
  const work = dispatch("implementation");
  state = reducer.reduceTeamRunEvent(state, envelope(6, { type: "task.dispatch_requested", taskId: "implementation", dispatch: work, leaseTokenHash: "hash" }));
  state = reducer.reduceTeamRunEvent(state, envelope(7, { type: "task.dispatch_accepted", taskId: "implementation", dispatchId: work.dispatchId, commandId: randomUUID() }));
  state = reducer.reduceTeamRunEvent(state, envelope(8, { type: "task.prompt_started", taskId: "implementation", dispatchId: work.dispatchId, promptRunId: randomUUID() }));
  const artifact = { id: randomUUID(), roomId, teamRunId: runId, taskId: "implementation", memberId: workerId, kind: "patch", name: "feature.patch", summary: "patch", createdAt: 1_009 };
  state = reducer.reduceTeamRunEvent(state, envelope(9, { type: "task.artifact_added", taskId: "implementation", artifact }, { kind: "member", memberId: workerId }));
  assert.throws(() => reducer.reduceTeamRunEvent(state, envelope(10, { type: "task.submitted", taskId: "implementation", submission: { summary: "done", evidenceIds: [], artifactIds: [artifact.id], submittedAt: 1_010 } }, { kind: "member", memberId: workerId })), (error) => error.code === "TEAM_EVIDENCE_REQUIRED");

  const evidence = { id: randomUUID(), teamRunId: runId, taskId: "implementation", memberId: workerId, kind: "verification", summary: "tests passed", source: "runtime", toolName: "bash", exitCode: 0, createdAt: 1_010 };
  assert.throws(() => reducer.reduceTeamRunEvent(state, envelope(10, { type: "task.evidence_added", taskId: "implementation", evidence }, { kind: "member", memberId: workerId })), /Only the runtime/);
  state = reducer.reduceTeamRunEvent(state, envelope(10, { type: "task.evidence_added", taskId: "implementation", evidence }));
  state = reducer.reduceTeamRunEvent(state, envelope(11, { type: "task.submitted", taskId: "implementation", submission: { summary: "done", evidenceIds: [evidence.id], artifactIds: [artifact.id], submittedAt: 1_011 } }, { kind: "member", memberId: workerId }));
  const review = dispatch("implementation", 1, "review", reviewerId);
  state = reducer.reduceTeamRunEvent(state, envelope(12, { type: "task.review_requested", taskId: "implementation", dispatches: [review] }));
  assert.throws(() => reducer.reduceTeamRunEvent(state, envelope(13, { type: "task.completed", taskId: "implementation" })), (error) => error.code === "TEAM_REVIEW_REQUIRED");
  const decision = { id: randomUUID(), teamRunId: runId, taskId: "implementation", reviewerMemberId: reviewerId, round: 0, verdict: "approved", summary: "approved", findings: [], evidenceIds: [evidence.id], createdAt: 1_013 };
  state = reducer.reduceTeamRunEvent(state, envelope(13, { type: "task.review_submitted", taskId: "implementation", decision }, { kind: "member", memberId: reviewerId }));
  state = reducer.reduceTeamRunEvent(state, envelope(14, { type: "task.completed", taskId: "implementation" }));
  assert.equal(state.tasks.implementation.status, "completed");
});

test("changes requested increments the review round and requeues only the target task", () => {
  let state = plannedState([task({ reviewPolicy: { required: true, reviewerMemberIds: [reviewerId], minimumApprovals: 1 } })]);
  state.tasks.implementation.status = "reviewing";
  state.tasks.implementation.attempt = 1;
  state.tasks.implementation.assignedMemberId = workerId;
  state.tasks.implementation.submission = { summary: "v1", evidenceIds: [], artifactIds: [], submittedAt: 1_000 };
  const decision = { id: randomUUID(), teamRunId: runId, taskId: "implementation", reviewerMemberId: reviewerId, round: 0, verdict: "changes_requested", summary: "fix", findings: [{ severity: "high", title: "bug", detail: "fix it" }], evidenceIds: [], createdAt: 1_005 };
  state = reducer.reduceTeamRunEvent(state, envelope(5, { type: "task.review_submitted", taskId: "implementation", decision }, { kind: "member", memberId: reviewerId }));
  state = reducer.reduceTeamRunEvent(state, envelope(6, { type: "task.changes_requested", taskId: "implementation", reason: "fix bug" }));
  assert.equal(state.tasks.implementation.reviewRound, 1);
  state = reducer.reduceTeamRunEvent(state, envelope(7, { type: "task.requeued", taskId: "implementation", reason: "retry" }));
  assert.equal(state.tasks.implementation.status, "ready");
  assert.equal(state.tasks.implementation.attempt, 1);
});

test("scheduler fuse counts scheduler decisions rather than evidence/progress events", () => {
  let state = plannedState([task({ reviewPolicy: { required: false, reviewerMemberIds: [], minimumApprovals: 0 } })]);
  for (let index = 0; index < 200; index += 1) {
    state = reducer.reduceTeamRunEvent(state, envelope(5 + index, { type: "run.progressed", summary: `progress ${index}` }));
  }
  assert.equal(state.revision, 204);
  assert.equal(state.schedulingSteps, 3);
});

test("terminal cancellation releases every active dispatch and task lease", () => {
  let state = plannedState();
  state = reducer.reduceTeamRunEvent(state, envelope(5, { type: "task.ready", taskId: "implementation" }));
  const work = dispatch("implementation");
  state = reducer.reduceTeamRunEvent(state, envelope(6, { type: "task.dispatch_requested", taskId: "implementation", dispatch: work, leaseTokenHash: "hash" }));
  state = reducer.reduceTeamRunEvent(state, envelope(7, { type: "run.cancelled", reason: "user cancelled" }));
  assert.equal(state.tasks.implementation.status, "cancelled");
  assert.equal(state.tasks.implementation.lease, undefined);
  assert.equal(state.activeDispatches[work.dispatchId].status, "interrupted");
});

test("resuming an interrupted run requeues unfinished tasks and clears the internal error", () => {
  let state = plannedState([task({ reviewPolicy: { required: false, reviewerMemberIds: [], minimumApprovals: 0 } })]);
  state = reducer.reduceTeamRunEvent(state, envelope(5, { type: "task.ready", taskId: "implementation" }));
  state = reducer.reduceTeamRunEvent(state, envelope(6, { type: "run.interrupted", reason: "temporary runtime failure" }));
  assert.equal(state.tasks.implementation.status, "interrupted");
  state = reducer.reduceTeamRunEvent(state, envelope(7, { type: "run.resumed", guidance: "retry now" }));
  assert.equal(state.phase, "running");
  assert.equal(state.tasks.implementation.status, "ready");
  assert.equal(state.waitingReason, undefined);
});
