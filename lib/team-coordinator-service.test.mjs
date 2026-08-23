import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "piora-team-coordinator-"));
process.env.PIORA_ROOMS_ROOT = root;
const jiti = createJiti(import.meta.url);
const rooms = await jiti.import("./room-store.ts");
const stores = await jiti.import("./team-run-store.ts");
const coordinatorModule = await jiti.import("./team-coordinator-service.ts");
const promptRuns = await jiti.import("./prompt-run-registry.ts");
const promptContexts = await jiti.import("./team-prompt-context.ts");
const tools = await jiti.import("./team-tool-service.ts");
const soakSeed = process.env.PIORA_TEAM_TEST_SEED?.trim();
let deterministicUuidCounter = 0;

function testUuid() {
  if (!soakSeed) return randomUUID();
  const hex = createHash("sha256")
    .update(`${soakSeed}:${deterministicUuidCounter++}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

class FakeRouter {
  commands = [];
  cancelled = [];
  listeners = new Map();

  async dispatchSessionMessage(input) {
    const commandId = `cmd_${testUuid()}`;
    this.commands.push({ commandId, input });
    return { accepted: true, commandId, sessionId: input.targetSessionId, status: "queued" };
  }

  async cancelCommand(commandId) {
    this.cancelled.push(commandId);
    const command = this.commands.find((item) => item.commandId === commandId);
    return { accepted: true, sessionId: command?.input.targetSessionId ?? "", status: "cancelled", commandId };
  }

  subscribeEvents(sessionId, listener) {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => set.delete(listener);
  }
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    if (Date.now() >= deadline) assert.fail(`Timed out after ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test.after(() => {
  coordinatorModule.resetTeamCoordinatorForTests();
  stores.resetTeamRunStoreForTests();
  promptContexts.resetTeamPromptContextsForTests();
  promptRuns.resetPromptRunRegistryForTests();
  delete process.env.PIORA_ROOMS_ROOT;
  rmSync(root, { recursive: true, force: true });
});

test("Fake Agents automatically progress planning, task execution, and synthesis to completed", async () => {
  let room = rooms.createRoom({ name: "Autonomous team", creator: { sessionId: "coordinator-session", name: "Coordinator", role: "coordinator" } });
  room = rooms.addRoomMember(room.id, { sessionId: "worker-session", name: "Worker", role: "worker" });
  room = rooms.configureRoomCoordination(room.id, { mode: "team", coordinatorSessionId: "coordinator-session", maxConcurrency: 2 });
  const store = new stores.TeamRunStore({ roomsRoot: root });
  const router = new FakeRouter();
  const service = new coordinatorModule.TeamCoordinatorService({ store, router, uuid: testUuid });
  globalThis.__pioraTeamCoordinator = service;
  globalThis.__pioraTeamRunStore = store;

  let state = await service.createRun({ roomId: room.id, objective: "Produce a verified report", coordinatorMemberId: room.coordination.coordinatorMemberId, createdBy: { kind: "user", id: "user" } });
  assert.equal(state.phase, "planning");
  assert.equal(router.commands.length, 1);

  const planningCommand = router.commands[0];
  await service.onSessionCommandEvent({ cursor: 1, type: "prompt_started", sessionId: "coordinator-session", commandId: planningCommand.commandId, runId: testUuid(), timestamp: Date.now() });
  const planningPrompt = promptRuns.beginPromptRun("coordinator-session");
  promptContexts.bindTeamPromptContext(planningPrompt, planningCommand.input.teamExecution);
  state = await tools.submitTeamPlan("coordinator-session", "plan-tool", {
    objective: "Produce a verified report",
    assumptions: [],
    successCriteria: [{ id: "delivered", description: "Report is delivered", required: true }],
    tasks: [{
      id: "report", title: "Create report", description: "Create and verify the report", acceptanceCriteria: ["Report content is complete"],
      requiredCapabilities: ["implementation"], dependsOn: [], reviewRequired: false,
    }],
  });
  await promptRuns.finishPromptRun(planningPrompt, "idle");
  await waitFor(() => router.commands.length >= 2);

  state = store.getTeamRun(room.id, state.id);
  const task = Object.values(state.tasks)[0];
  assert.ok(task);
  assert.ok(["dispatching", "queued"].includes(task.status));
  assert.equal(router.commands.length, 2);

  const workerCommand = router.commands[1];
  const workerRunId = testUuid();
  await service.onSessionCommandEvent({ cursor: 2, type: "prompt_started", sessionId: "worker-session", commandId: workerCommand.commandId, runId: workerRunId, timestamp: Date.now() });
  const workerPrompt = promptRuns.beginPromptRun("worker-session");
  promptContexts.bindTeamPromptContext(workerPrompt, workerCommand.input.teamExecution);
  const evidenceResult = await tools.addTeamEvidence("worker-session", "evidence-tool", { kind: "observation", summary: "Report content inspected" });
  const artifactResult = await tools.publishTeamArtifact("worker-session", "artifact-tool", { kind: "report", name: "report.md", summary: "Completed report" });
  state = await tools.submitTeamTask("worker-session", "submit-tool", {
    summary: "Report completed", evidenceIds: [evidenceResult.evidence.id], artifactIds: [artifactResult.artifact.id],
  });
  await promptRuns.finishPromptRun(workerPrompt, "idle");
  await waitFor(() => store.getTeamRun(room.id, state.id).phase === "synthesizing" && router.commands.length >= 3);

  state = store.getTeamRun(room.id, state.id);
  assert.equal(state.tasks[task.id].status, "completed");
  assert.equal(state.phase, "synthesizing");
  assert.equal(router.commands.length, 3);

  const firstSynthesisCommand = router.commands[2];
  await service.onSessionCommandEvent({ cursor: 3, type: "command_completed", sessionId: "coordinator-session", commandId: firstSynthesisCommand.commandId, timestamp: Date.now() });
  const synthesisCommand = router.commands.at(-1);
  assert.notEqual(synthesisCommand.commandId, firstSynthesisCommand.commandId);
  await service.onSessionCommandEvent({ cursor: 3, type: "prompt_started", sessionId: "coordinator-session", commandId: synthesisCommand.commandId, runId: testUuid(), timestamp: Date.now() });
  const synthesisPrompt = promptRuns.beginPromptRun("coordinator-session");
  promptContexts.bindTeamPromptContext(synthesisPrompt, synthesisCommand.input.teamExecution);
  state = await tools.completeTeamRun("coordinator-session", "complete-tool", {
    summary: "Verified report delivered", finalArtifactIds: [artifactResult.artifact.id], successCriteriaEvidence: { delivered: [evidenceResult.evidence.id] },
  });
  await promptRuns.finishPromptRun(synthesisPrompt, "idle");
  assert.equal(state.phase, "completed");
  assert.equal(state.finalSummary, "Verified report delivered");
  const visibleMessages = rooms.listRoomMessages(room.id);
  assert.ok(visibleMessages.some((message) => message.content.includes("团队计划已开始")));
  assert.ok(visibleMessages.some((message) => message.content.includes("开始执行：**Create report**")));
  assert.ok(visibleMessages.some((message) => message.content.includes("已完成：**Create report**")));
  assert.equal(rooms.listRoomMessages(room.id).filter((message) => message.correlationId === `team:${room.id}:${state.id}:final`).length, 1);
  await service.deliverPendingOutbox(room.id, state.id);
  assert.equal(rooms.listRoomMessages(room.id).filter((message) => message.correlationId === `team:${room.id}:${state.id}:final`).length, 1);
});

test("concurrent create requests with one idempotency key produce one TeamRun and one planning dispatch", async () => {
  let room = rooms.createRoom({ name: "Idempotent create", creator: { sessionId: "idem-lead", role: "coordinator" } });
  room = rooms.addRoomMember(room.id, { sessionId: "idem-worker", role: "worker" });
  room = rooms.configureRoomCoordination(room.id, { mode: "team", coordinatorSessionId: "idem-lead" });
  const store = new stores.TeamRunStore({ roomsRoot: root });
  const router = new FakeRouter();
  const service = new coordinatorModule.TeamCoordinatorService({ store, router, uuid: testUuid });
  globalThis.__pioraTeamCoordinator = service;
  globalThis.__pioraTeamRunStore = store;
  const input = { roomId: room.id, objective: "Exactly once", coordinatorMemberId: room.coordination.coordinatorMemberId, createdBy: { kind: "user", id: "user" }, correlationId: "same-create-key" };
  const results = await Promise.all(Array.from({ length: 20 }, () => service.createRun(input)));
  assert.equal(new Set(results.map((state) => state.id)).size, 1);
  assert.equal(store.listTeamRuns(room.id).length, 1);
  assert.equal(router.commands.length, 1);
});

test("planning retries structured-submission omissions up to a bounded recoverable interruption", async () => {
  let room = rooms.createRoom({ name: "Planning retry", creator: { sessionId: "retry-lead", role: "coordinator" } });
  room = rooms.configureRoomCoordination(room.id, { mode: "team", coordinatorSessionId: "retry-lead" });
  const store = new stores.TeamRunStore({ roomsRoot: root });
  const router = new FakeRouter();
  const service = new coordinatorModule.TeamCoordinatorService({ store, router, uuid: testUuid });
  globalThis.__pioraTeamCoordinator = service;
  globalThis.__pioraTeamRunStore = store;
  let state = await service.createRun({ roomId: room.id, objective: "Retry planning", coordinatorMemberId: room.coordination.coordinatorMemberId, createdBy: { kind: "user", id: "user" } });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const command = router.commands.at(-1);
    await service.onSessionCommandEvent({ cursor: attempt + 1, type: "command_completed", sessionId: "retry-lead", commandId: command.commandId, timestamp: Date.now() });
  }
  state = store.getTeamRun(room.id, state.id);
  assert.equal(router.commands.length, 3);
  assert.equal(state.phase, "interrupted");
  assert.match(state.waitingReason, /不是你缺少信息/);
  state = await service.resumeRun(room.id, state.id, "Use a smaller plan");
  assert.equal(state.phase, "planning");
  assert.equal(router.commands.length, 4);
  assert.equal(router.commands.at(-1).input.teamExecution.attempt, 1);
});

test("capability routing falls back to a ready generalist when no exact specialist exists", async () => {
  let room = rooms.createRoom({ name: "Capability gate", creator: { sessionId: "cap-lead", role: "coordinator" } });
  room = rooms.addRoomMember(room.id, { sessionId: "cap-worker", role: "worker" });
  room = rooms.configureRoomCoordination(room.id, { mode: "team", coordinatorSessionId: "cap-lead" });
  const store = new stores.TeamRunStore({ roomsRoot: root });
  const router = new FakeRouter();
  const service = new coordinatorModule.TeamCoordinatorService({ store, router, uuid: testUuid });
  globalThis.__pioraTeamCoordinator = service;
  globalThis.__pioraTeamRunStore = store;
  let state = await service.createRun({ roomId: room.id, objective: "Needs unavailable capability", coordinatorMemberId: room.coordination.coordinatorMemberId, createdBy: { kind: "user", id: "user" } });
  const planning = router.commands.at(-1);
  await service.onSessionCommandEvent({ cursor: 1, type: "prompt_started", sessionId: "cap-lead", commandId: planning.commandId, runId: testUuid(), timestamp: Date.now() });
  const prompt = promptRuns.beginPromptRun("cap-lead");
  promptContexts.bindTeamPromptContext(prompt, planning.input.teamExecution);
  state = await tools.submitTeamPlan("cap-lead", "plan", { objective: state.objective, assumptions: [], successCriteria: [{ id: "done", description: "Done" }], tasks: [{ id: "special", title: "Specialized work", description: "Needs a specialist", acceptanceCriteria: ["Done"], requiredCapabilities: ["quantum-compiler"], dependsOn: [], reviewRequired: false }] });
  await promptRuns.finishPromptRun(prompt, "idle");
  await waitFor(() => router.commands.length >= 2);
  state = store.getTeamRun(room.id, state.id);
  assert.equal(state.phase, "running");
  assert.ok(["dispatching", "queued"].includes(state.tasks[`${state.id}:special`].status));
  assert.equal(router.commands[1].input.targetSessionId, "cap-worker");
});

test("review changes_requested requeues only the reviewed task and increments attempt and round", async () => {
  let room = rooms.createRoom({ name: "Review gate", creator: { sessionId: "review-lead", role: "coordinator" } });
  room = rooms.addRoomMember(room.id, { sessionId: "review-worker", role: "worker" });
  room = rooms.addRoomMember(room.id, { sessionId: "review-reviewer", role: "reviewer" });
  room = rooms.configureRoomCoordination(room.id, { mode: "team", coordinatorSessionId: "review-lead" });
  const store = new stores.TeamRunStore({ roomsRoot: root });
  const router = new FakeRouter();
  const service = new coordinatorModule.TeamCoordinatorService({ store, router, uuid: testUuid });
  globalThis.__pioraTeamCoordinator = service;
  globalThis.__pioraTeamRunStore = store;
  let state = await service.createRun({ roomId: room.id, objective: "Reviewed delivery", coordinatorMemberId: room.coordination.coordinatorMemberId, createdBy: { kind: "user", id: "user" } });
  const planning = router.commands.at(-1);
  await service.onSessionCommandEvent({ cursor: 1, type: "prompt_started", sessionId: "review-lead", commandId: planning.commandId, runId: testUuid(), timestamp: Date.now() });
  let prompt = promptRuns.beginPromptRun("review-lead");
  promptContexts.bindTeamPromptContext(prompt, planning.input.teamExecution);
  await tools.submitTeamPlan("review-lead", "plan", { objective: state.objective, assumptions: [], successCriteria: [{ id: "done", description: "Done" }], tasks: [{ id: "work", title: "Reviewed work", description: "Produce report", acceptanceCriteria: ["Correct"], requiredCapabilities: ["implementation"], dependsOn: [], reviewRequired: true }] });
  await promptRuns.finishPromptRun(prompt, "idle");
  await waitFor(() => router.commands.some((command) => command.input.targetSessionId === "review-worker"));
  const workerCommand = router.commands.find((command) => command.input.targetSessionId === "review-worker");
  await service.onSessionCommandEvent({ cursor: 2, type: "prompt_started", sessionId: "review-worker", commandId: workerCommand.commandId, runId: testUuid(), timestamp: Date.now() });
  prompt = promptRuns.beginPromptRun("review-worker");
  promptContexts.bindTeamPromptContext(prompt, workerCommand.input.teamExecution);
  const evidence = await tools.addTeamEvidence("review-worker", "evidence", { summary: "Inspected output" });
  const artifact = await tools.publishTeamArtifact("review-worker", "artifact", { kind: "report", name: "review.txt", summary: "Candidate" });
  await tools.submitTeamTask("review-worker", "submit", { summary: "Candidate", evidenceIds: [evidence.evidence.id], artifactIds: [artifact.artifact.id] });
  await promptRuns.finishPromptRun(prompt, "idle");
  await waitFor(() => router.commands.some((command) => command.input.targetSessionId === "review-reviewer"));
  const firstReviewerCommand = router.commands.find((command) => command.input.targetSessionId === "review-reviewer");
  assert.ok(firstReviewerCommand);
  await service.onSessionCommandEvent({ cursor: 3, type: "command_completed", sessionId: "review-reviewer", commandId: firstReviewerCommand.commandId, timestamp: Date.now() });
  const reviewerCommand = router.commands.filter((command) => command.input.targetSessionId === "review-reviewer").at(-1);
  assert.notEqual(reviewerCommand.commandId, firstReviewerCommand.commandId);
  await service.onSessionCommandEvent({ cursor: 3, type: "prompt_started", sessionId: "review-reviewer", commandId: reviewerCommand.commandId, runId: testUuid(), timestamp: Date.now() });
  prompt = promptRuns.beginPromptRun("review-reviewer");
  promptContexts.bindTeamPromptContext(prompt, reviewerCommand.input.teamExecution);
  await tools.submitTeamReview("review-reviewer", "review", { verdict: "changes_requested", summary: "Fix the edge case", findings: [{ severity: "high", title: "Edge case", detail: "Missing boundary handling" }], evidenceIds: [] });
  await promptRuns.finishPromptRun(prompt, "idle");
  await waitFor(() => {
    const latest = store.getTeamRun(room.id, state.id);
    const task = Object.values(latest.tasks)[0];
    return task?.reviewRound === 1 && task.attempt === 2
      && router.commands.filter((command) => command.input.targetSessionId === "review-worker").length === 2;
  });
  state = store.getTeamRun(room.id, state.id);
  const task = Object.values(state.tasks)[0];
  assert.equal(task.reviewRound, 1);
  assert.equal(task.attempt, 2);
  assert.ok(["dispatching", "queued"].includes(task.status));
  assert.equal(router.commands.filter((command) => command.input.targetSessionId === "review-worker").length, 2);
});

test("a completed command without structured task submission interrupts and requeues only that task", async () => {
  let room = rooms.createRoom({ name: "Missing submit", creator: { sessionId: "lead-session", name: "Lead", role: "coordinator" } });
  room = rooms.addRoomMember(room.id, { sessionId: "builder-session", name: "Builder", role: "worker" });
  room = rooms.configureRoomCoordination(room.id, { mode: "team", coordinatorSessionId: "lead-session" });
  const store = new stores.TeamRunStore({ roomsRoot: root });
  const router = new FakeRouter();
  const service = new coordinatorModule.TeamCoordinatorService({ store, router, uuid: testUuid });
  globalThis.__pioraTeamCoordinator = service;
  globalThis.__pioraTeamRunStore = store;
  let state = await service.createRun({ roomId: room.id, objective: "Do work", coordinatorMemberId: room.coordination.coordinatorMemberId, createdBy: { kind: "user", id: "user" } });
  const planning = router.commands.at(-1);
  await service.onSessionCommandEvent({ cursor: 1, type: "prompt_started", sessionId: "lead-session", commandId: planning.commandId, runId: testUuid(), timestamp: Date.now() });
  const prompt = promptRuns.beginPromptRun("lead-session");
  promptContexts.bindTeamPromptContext(prompt, planning.input.teamExecution);
  await tools.submitTeamPlan("lead-session", "plan", { objective: "Do work", assumptions: [], successCriteria: [{ id: "done", description: "Done" }], tasks: [{ id: "work", title: "Work", description: "Do it", acceptanceCriteria: ["Done"], requiredCapabilities: ["implementation"], dependsOn: [], reviewRequired: false }] });
  await promptRuns.finishPromptRun(prompt, "idle");
  await waitFor(() => router.commands.some((command) => command.input.targetSessionId === "builder-session"));
  const workCommand = router.commands.at(-1);
  await service.onSessionCommandEvent({ cursor: 2, type: "prompt_started", sessionId: "builder-session", commandId: workCommand.commandId, runId: testUuid(), timestamp: Date.now() });
  await service.onSessionCommandEvent({ cursor: 3, type: "command_completed", sessionId: "builder-session", commandId: workCommand.commandId, timestamp: Date.now() });
  state = store.getTeamRun(room.id, state.id);
  assert.ok(["ready", "dispatching", "queued"].includes(Object.values(state.tasks)[0].status));
  assert.equal(Object.values(state.tasks)[0].attempt, 2);
});

test("hot reload refreshes coordinator methods without dropping the live service instance", () => {
  const store = new stores.TeamRunStore({ roomsRoot: root });
  const service = new coordinatorModule.TeamCoordinatorService({ store, router: new FakeRouter(), uuid: testUuid });
  globalThis.__pioraTeamCoordinator = service;
  Object.setPrototypeOf(service, { stale: true });
  const refreshed = coordinatorModule.getTeamCoordinatorService();
  assert.equal(refreshed, service);
  assert.ok(refreshed instanceof coordinatorModule.TeamCoordinatorService);
  assert.equal(typeof refreshed.reconcile, "function");
});
