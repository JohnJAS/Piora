import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const promptRuns = await jiti.import("./prompt-run-registry.ts");
const goals = await jiti.import("./goal-run-registry.ts");

test.afterEach(() => {
  goals.resetGoalRunRegistryForTests();
  promptRuns.resetPromptRunRegistryForTests();
});

test("a saved goal remains active until explicit completion", async () => {
  const run = promptRuns.beginPromptRun("session-goal");
  goals.beginGoalRun(run, "Open settings and verify Wi-Fi is enabled");
  const tool = promptRuns.requirePromptToolIdentity("session-goal", "tool-1");
  goals.updateGoalProgress(tool, "Settings is open");
  assert.equal(goals.advanceGoalIteration(run).iteration, 1);
  assert.equal(goals.getGoalRun("session-goal")?.status, "active");
  goals.addGoalEvidence(tool, "The settings tree reports Wi-Fi enabled", "observation");
  const completed = goals.completeGoal(tool, "Wi-Fi toggle is visibly enabled");
  assert.equal(completed.status, "complete");
  assert.equal(completed.summary, "Wi-Fi toggle is visibly enabled");
  await promptRuns.finishPromptRun(run, "idle");
  assert.equal(goals.getGoalRun("session-goal")?.status, "complete");
  assert.equal(goals.getGoalRun("session-goal")?.evidence.length, 1);
});

test("a saved goal supports a precise blocked terminal state", async () => {
  const run = promptRuns.beginPromptRun("session-blocked");
  goals.beginGoalRun(run, "Complete a step that needs the user");
  const tool = promptRuns.requirePromptToolIdentity("session-blocked", "tool-2");
  const blocked = goals.blockGoal(tool, "User must approve the system permission dialog");
  assert.equal(blocked.status, "blocked");
  assert.throws(() => goals.completeGoal(tool, "not allowed"), /already blocked/);
  await promptRuns.finishPromptRun(run, "idle");
});

test("a saved goal distinguishes a user decision from an external blocker", async () => {
  const firstRun = promptRuns.beginPromptRun("session-waiting");
  const original = goals.beginGoalRun(firstRun, "Publish with a user-selected visibility");
  const tool = promptRuns.requirePromptToolIdentity("session-waiting", "tool-waiting");
  const waiting = goals.waitGoalForUser(tool, "Choose public or private visibility");
  assert.equal(waiting.status, "waiting_user");
  assert.match(waiting.reason, /public or private/);
  await promptRuns.finishPromptRun(firstRun, "idle");

  const secondRun = promptRuns.beginPromptRun("session-waiting");
  const resumed = goals.beginGoalRun(secondRun, "Use private visibility");
  assert.equal(resumed.goalId, original.goalId);
  assert.equal(resumed.status, "active");
});

test("completion is rejected until concrete evidence exists", () => {
  const run = promptRuns.beginPromptRun("session-unverified");
  goals.beginGoalRun(run, "Implement and verify a change");
  const tool = promptRuns.requirePromptToolIdentity("session-unverified", "tool-3");
  assert.throws(() => goals.completeGoal(tool, "Looks done"), /verification evidence/);
});

test("a paused goal survives prompt cleanup and rebinds to the next extension turn", async () => {
  const firstRun = promptRuns.beginPromptRun("session-resume");
  const original = goals.beginGoalRun(firstRun, "Finish the persistent objective");
  goals.pauseGoalRun("session-resume", "User stopped the run");
  await promptRuns.finishPromptRun(firstRun, "abort");

  const secondRun = promptRuns.beginPromptRun("session-resume");
  const resumed = goals.beginGoalRun(secondRun, "Continue after inspecting the failure");
  assert.equal(resumed.goalId, original.goalId);
  assert.equal(resumed.runId, secondRun.runId);
  assert.equal(resumed.status, "active");
  assert.match(resumed.checkpoints.at(-1)?.message ?? "", /User continuation/);
});

test("restoring an interrupted persisted goal pauses it safely", () => {
  const run = promptRuns.beginPromptRun("session-restore");
  const active = goals.beginGoalRun(run, "Persist me");
  goals.resetGoalRunRegistryForTests();

  const restored = goals.restoreGoalRunFromEntries("session-restore", [{
    type: "custom",
    customType: goals.GOAL_RUN_ENTRY_TYPE,
    data: active,
  }]);
  assert.equal(restored?.goalId, active.goalId);
  assert.equal(restored?.status, "paused");
  assert.match(restored?.reason ?? "", /restored/);
});
