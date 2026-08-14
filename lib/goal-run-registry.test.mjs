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

test("target mode remains active across iterations until explicit completion", async () => {
  const run = promptRuns.beginPromptRun("session-goal");
  goals.beginGoalRun(run, "Open settings and verify Wi-Fi is enabled");
  const tool = promptRuns.requirePromptToolIdentity("session-goal", "tool-1");
  goals.updateGoalProgress(tool, "Settings is open");
  assert.equal(goals.advanceGoalIteration(run).iteration, 1);
  assert.equal(goals.getGoalRun("session-goal")?.status, "active");
  const completed = goals.completeGoal(tool, "Wi-Fi toggle is visibly enabled");
  assert.equal(completed.status, "complete");
  assert.equal(completed.summary, "Wi-Fi toggle is visibly enabled");
  await promptRuns.finishPromptRun(run, "idle");
  assert.equal(goals.getGoalRun("session-goal"), undefined);
});

test("target mode supports a precise blocked terminal state", async () => {
  const run = promptRuns.beginPromptRun("session-blocked");
  goals.beginGoalRun(run, "Complete a step that needs the user");
  const tool = promptRuns.requirePromptToolIdentity("session-blocked", "tool-2");
  const blocked = goals.blockGoal(tool, "User must approve the system permission dialog");
  assert.equal(blocked.status, "blocked");
  assert.throws(() => goals.completeGoal(tool, "not allowed"), /already blocked/);
  await promptRuns.finishPromptRun(run, "idle");
});
