import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "piora-team-context-"));
process.env.PIORA_ROOMS_ROOT = root;
const jiti = createJiti(import.meta.url);
const rooms = await jiti.import("./room-store.ts");
const teamStoreModule = await jiti.import("./team-run-store.ts");
const prompts = await jiti.import("./prompt-run-registry.ts");
const contexts = await jiti.import("./team-prompt-context.ts");
const secrets = await jiti.import("./team-execution-secrets.ts");
const { default: registerRoomExtension } = await jiti.import("../extensions/piora-room.ts");

test.after(() => {
  contexts.resetTeamPromptContextsForTests();
  prompts.resetPromptRunRegistryForTests();
  teamStoreModule.resetTeamRunStoreForTests();
  delete process.env.PIORA_ROOMS_ROOT;
  rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const room = rooms.createRoom({ name: "Team", creator: { sessionId: "session-a", name: "Lead", role: "coordinator" } });
  const member = room.members[0];
  const store = new teamStoreModule.TeamRunStore({ roomsRoot: root });
  let state = await store.createTeamRun({ roomId: room.id, objective: "Plan it", coordinatorMemberId: member.memberId, createdBy: { kind: "user", id: "user" } });
  const token = "secret-token";
  const dispatch = {
    dispatchId: randomUUID(), purpose: "planning", taskId: "__planning__", memberId: member.memberId,
    sessionId: member.binding.sessionId, attempt: 1,
    leaseTokenHash: createHash("sha256").update(token).digest("hex"), status: "requested",
    requestedAt: Date.now(), updatedAt: Date.now(),
  };
  state = await store.appendTeamRunEvents(room.id, state.id, state.revision, [{ type: "planning.requested", dispatch }]);
  teamStoreModule.resetTeamRunStoreForTests();
  const context = {
    schemaVersion: 1, roomId: room.id, teamRunId: state.id, taskId: "__planning__", dispatchId: dispatch.dispatchId,
    memberId: member.memberId, profileRevision: member.profile.revision, attempt: 1, leaseToken: token, purpose: "planning",
  };
  return { room, member, state, context };
}

test("Team Prompt Context binds to the exact PromptRun and cleans up on finish", async () => {
  const { context } = await fixture();
  const prompt = prompts.beginPromptRun("session-a");
  contexts.bindTeamPromptContext(prompt, context);
  assert.deepEqual(contexts.getActiveTeamPromptContext("session-a"), context);
  const tool = contexts.requireTeamToolContext("session-a", "tool-1");
  assert.equal(tool.runId, prompt.runId);
  assert.equal(tool.context.teamRunId, context.teamRunId);
  await prompts.finishPromptRun(prompt, "idle");
  assert.equal(contexts.getActiveTeamPromptContext("session-a"), undefined);
  assert.equal(contexts.activeTeamPromptContextCount(), 0);
});

test("normal prompts and other Rooms never acquire Team identity", async () => {
  await fixture();
  const ordinary = prompts.beginPromptRun("ordinary-session");
  assert.equal(contexts.getActiveTeamPromptContext("ordinary-session"), undefined);
  assert.throws(() => contexts.requireTeamToolContext("ordinary-session", "tool"), /not attached to an active Team prompt/);
  await prompts.finishPromptRun(ordinary, "idle");
});

test("Room extension appends the exact Agent system prompt once and never exposes the lease token", async () => {
  const { context } = await fixture();
  const handlers = new Map();
  registerRoomExtension({
    registerTool() {},
    on(name, handler) { handlers.set(name, handler); },
  });
  const beforeStart = handlers.get("before_agent_start");
  assert.equal(typeof beforeStart, "function");
  const ctx = { sessionManager: { getSessionId: () => "session-a" }, ui: { setStatus() {} } };
  assert.equal(await beforeStart({ systemPrompt: "BASE CODING PROMPT" }, ctx), undefined);

  const prompt = prompts.beginPromptRun("session-a");
  contexts.bindTeamPromptContext(prompt, context);
  const injected = await beforeStart({ systemPrompt: "BASE CODING PROMPT" }, ctx);
  assert.ok(injected.systemPrompt.startsWith("BASE CODING PROMPT\n\n[PIORA TEAM AGENT IDENTITY]"));
  assert.equal(injected.systemPrompt.match(/PIORA TEAM AGENT IDENTITY/g).length, 1);
  assert.match(injected.message.content, new RegExp(context.teamRunId));
  assert.doesNotMatch(injected.message.content, /secret-token|Lease token/);
  await prompts.finishPromptRun(prompt, "idle");
  assert.equal(await beforeStart({ systemPrompt: "BASE CODING PROMPT" }, ctx), undefined);
});

test("admission rejects spoofed member, Session, profile revision, dispatch, and lease", async () => {
  const { context } = await fixture();
  assert.throws(() => contexts.validateTeamExecutionContext({ ...context, memberId: "spoof" }, "session-a"), (error) => error.code === "TEAM_INVALID_CONTEXT");
  assert.throws(() => contexts.validateTeamExecutionContext(context, "session-b"), (error) => error.code === "TEAM_INVALID_CONTEXT");
  assert.throws(() => contexts.validateTeamExecutionContext({ ...context, profileRevision: context.profileRevision + 1 }, "session-a"), (error) => error.code === "TEAM_INVALID_CONTEXT");
  assert.throws(() => contexts.validateTeamExecutionContext({ ...context, dispatchId: randomUUID() }, "session-a"), (error) => error.code === "TEAM_INVALID_CONTEXT");
  assert.throws(() => contexts.validateTeamExecutionContext({ ...context, leaseToken: "wrong" }, "session-a"), (error) => error.code === "TEAM_LEASE_INVALID");
});

test("persisted command references never contain the plaintext lease token", async () => {
  const { context } = await fixture();
  const ref = secrets.persistTeamExecutionContext(context);
  assert.equal(JSON.stringify(ref).includes(context.leaseToken), false);
  assert.deepEqual(secrets.resolveTeamExecutionContext(ref), context);
  const path = teamStoreModule.getTeamRunStore().paths(context.roomId, context.teamRunId).secrets;
  assert.ok(readFileSync(path, "utf8").includes(context.leaseToken));
  secrets.deleteTeamExecutionSecret(ref);
  assert.throws(() => secrets.resolveTeamExecutionContext(ref), (error) => error.code === "TEAM_LEASE_INVALID");
});

test("2 Rooms and 4 Agents keep 100 interleaved Team prompts isolated from 100 normal prompts", async () => {
  const store = new teamStoreModule.TeamRunStore({ roomsRoot: root });
  globalThis.__pioraTeamRunStore = store;
  const teamContexts = [];
  for (let roomIndex = 0; roomIndex < 2; roomIndex += 1) {
    let room = rooms.createRoom({ name: `Isolation ${roomIndex}`, creator: { sessionId: `iso-${roomIndex}-lead`, role: "coordinator" } });
    room = rooms.addRoomMember(room.id, { sessionId: `iso-${roomIndex}-worker`, role: "worker" });
    let state = await store.createTeamRun({ roomId: room.id, objective: "Isolation", coordinatorMemberId: room.members[0].memberId, createdBy: { kind: "user", id: "user" } });
    const planning = dispatchFor(room.members[0], "__planning__", "planning", 1);
    const tasks = room.members.map((member, taskIndex) => ({
      schemaVersion: 1, id: `task-${taskIndex}`, teamRunId: state.id, title: `Task ${taskIndex}`, description: "Isolated work",
      acceptanceCriteria: ["Done"], requiredCapabilities: [], dependsOn: [], priority: 0, status: "pending", assignmentMode: "fixed",
      preferredMemberId: member.memberId, attempt: 0, maxAttempts: 3,
      reviewPolicy: { required: false, reviewerMemberIds: [], minimumApprovals: 0 }, reviewRound: 0, createdAt: Date.now(), updatedAt: Date.now(),
    }));
    const plan = { schemaVersion: 1, revision: 1, objective: "Isolation", assumptions: [], successCriteria: [], taskIds: tasks.map((item) => item.id), submittedByMemberId: room.members[0].memberId, createdAt: Date.now(), updatedAt: Date.now() };
    state = await store.appendTeamRunEvents(room.id, state.id, state.revision, [
      { type: "planning.requested", dispatch: planning }, { type: "plan.submitted", plan, tasks }, { type: "run.started" },
      ...tasks.map((item) => ({ type: "task.ready", taskId: item.id })),
    ]);
    for (let memberIndex = 0; memberIndex < room.members.length; memberIndex += 1) {
      const member = room.members[memberIndex];
      const task = state.tasks[`task-${memberIndex}`];
      const token = `isolation-token-${roomIndex}-${memberIndex}`;
      const active = dispatchFor(member, task.id, "task", 1, token);
      state = await store.appendTeamRunEvents(room.id, state.id, state.revision, [{
        type: "task.dispatch_requested", taskId: task.id, dispatch: active, leaseTokenHash: active.leaseTokenHash,
      }]);
      teamContexts.push({
        sessionId: member.binding.sessionId,
        context: { schemaVersion: 1, roomId: room.id, teamRunId: state.id, taskId: task.id, dispatchId: active.dispatchId,
          memberId: member.memberId, profileRevision: member.profile.revision, attempt: 1, leaseToken: token, purpose: "task" },
      });
    }
  }

  for (let index = 0; index < 100; index += 1) {
    const selected = teamContexts[index % teamContexts.length];
    const teamPrompt = prompts.beginPromptRun(selected.sessionId);
    contexts.bindTeamPromptContext(teamPrompt, selected.context);
    assert.equal(contexts.getActiveTeamPromptContext(selected.sessionId)?.dispatchId, selected.context.dispatchId);
    const normalSession = `ordinary-${index % 4}`;
    const normalPrompt = prompts.beginPromptRun(normalSession);
    assert.equal(contexts.getActiveTeamPromptContext(normalSession), undefined);
    await prompts.finishPromptRun(normalPrompt, "idle");
    await prompts.finishPromptRun(teamPrompt, "idle");
  }
  assert.equal(contexts.activeTeamPromptContextCount(), 0);
});

function dispatchFor(member, taskId, purpose, attempt, token = `token-${randomUUID()}`) {
  return {
    dispatchId: randomUUID(), purpose, taskId, memberId: member.memberId, sessionId: member.binding.sessionId, attempt,
    leaseTokenHash: createHash("sha256").update(token).digest("hex"), status: "requested", requestedAt: Date.now(), updatedAt: Date.now(),
  };
}
