import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const promptRuns = await jiti.import("./prompt-run-registry.ts");
const goals = await jiti.import("./goal-run-registry.ts");
const { default: registerGoalExtension } = await jiti.import("../extensions/piora-goal.ts");

test.afterEach(() => {
  goals.resetGoalRunRegistryForTests();
  promptRuns.resetPromptRunRegistryForTests();
});

function createHarness(sessionId) {
  let tool;
  const commands = new Map();
  const handlers = new Map();
  const entries = [];
  const notifications = [];
  const statuses = [];
  const widgets = [];
  const api = {
    registerTool(value) { tool = value; },
    registerCommand(name, value) { commands.set(name, value); },
    on(name, handler) { handlers.set(name, handler); },
    appendEntry(customType, data) { entries.push({ customType, data }); },
  };
  registerGoalExtension(api);
  const ctx = {
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () => entries.map((entry) => ({ type: "custom", ...entry })),
    },
    ui: {
      notify(message, type) { notifications.push({ message, type }); },
      setStatus(key, text) { statuses.push({ key, text }); },
      setWidget(key, lines, options) { widgets.push({ key, lines, options }); },
    },
  };
  return { get tool() { return tool; }, commands, handlers, entries, notifications, statuses, widgets, ctx };
}

test("goal tool records checkpoints and evidence before completing", async () => {
  const harness = createHarness("session-tool");
  const run = promptRuns.beginPromptRun("session-tool");
  goals.beginGoalRun(run, "Ship a verified target-mode MVP");

  await harness.tool.execute("tool-progress", { action: "progress", message: "Persistence implemented" }, undefined, undefined, harness.ctx);
  await harness.tool.execute("tool-evidence", { action: "evidence", message: "Typecheck passed", evidenceKind: "verification" }, undefined, undefined, harness.ctx);
  const result = await harness.tool.execute("tool-complete", { action: "complete", message: "Tests and typecheck passed" }, undefined, undefined, harness.ctx);

  assert.equal(result.details.status, "complete");
  assert.equal(goals.getGoalRun("session-tool")?.checkpoints.length, 1);
  assert.equal(goals.getGoalRun("session-tool")?.evidence.length, 2);
  assert.equal(harness.entries.at(-1)?.customType, goals.GOAL_RUN_ENTRY_TYPE);
});

test("goal command pauses, prepares resume, and cancels persistent state", async () => {
  const harness = createHarness("session-command");
  const run = promptRuns.beginPromptRun("session-command");
  goals.beginGoalRun(run, "A controllable goal");
  const command = harness.commands.get("goal");

  await command.handler("pause waiting for review", harness.ctx);
  assert.equal(goals.getGoalRun("session-command")?.status, "paused");
  await command.handler("resume", harness.ctx);
  assert.match(goals.getGoalRun("session-command")?.reason ?? "", /Resume requested/);
  await command.handler("cancel superseded", harness.ctx);
  assert.equal(goals.getGoalRun("session-command")?.status, "cancelled");
  assert.ok(harness.notifications.length >= 3);
});
