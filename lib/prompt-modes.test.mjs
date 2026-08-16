import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const modes = await jiti.import("./prompt-mode-runtime.ts");
const goals = await jiti.import("./goal-run-registry.ts");
const promptRuns = await jiti.import("./prompt-run-registry.ts");

test.afterEach(() => {
  goals.resetGoalRunRegistryForTests();
  promptRuns.resetPromptRunRegistryForTests();
  modes.resetActivePromptModesForTests();
});

function createPlanSession({ tools = ["read", "bash", "edit", "grep"] } = {}) {
  let activeTools = [...tools];
  return {
    getActiveToolNames: () => [...activeTools],
    setActiveToolsByName: (names) => {
      activeTools = [...names];
    },
  };
}

test("plan mode enforces read-only tools and restores the exact prior tool state", () => {
  const session = createPlanSession();
  const lease = modes.enterPlanMode(session);

  assert.deepEqual(session.getActiveToolNames(), ["read", "grep"]);
  assert.deepEqual(lease.activeTools, ["read", "grep"]);
  lease.restore();
  lease.restore();
  assert.deepEqual(session.getActiveToolNames(), ["read", "bash", "edit", "grep"]);
});

test("plan mode allows only read tools plus the metadata-only plan submission tool", () => {
  assert.deepEqual(
    modes.selectPlanModeTools(["piora_plan", "read", "bash", "edit", "browser", "grep"]),
    ["piora_plan", "read", "grep"],
  );
});

test("active prompt modes are run-scoped and ignore stale cleanup", () => {
  const first = { sessionId: "session-mode", runId: "run-first" };
  const second = { sessionId: "session-mode", runId: "run-second" };
  modes.beginActivePromptMode(first, "plan");
  modes.beginActivePromptMode(second, "goal");
  modes.finishActivePromptMode(first);
  assert.deepEqual(modes.getActivePromptMode(first.sessionId), { ...second, mode: "goal" });
  modes.finishActivePromptMode(second);
  assert.equal(modes.getActivePromptMode(first.sessionId), undefined);
});

test("target mode continues while active and stops at the documented safety fuse", async () => {
  const run = promptRuns.beginPromptRun("session-continuation-limit");
  goals.beginGoalRun(run, "Keep progressing until the safety fuse is reached");
  const prompts = [];
  const states = [];

  const result = await modes.runGoalModeContinuations({
    session: {
      sessionId: run.sessionId,
      prompt: async (message, options) => {
        prompts.push({ message, options });
      },
    },
    promptRun: run,
    maxContinuations: 2,
    onStateChange: (state) => states.push(state),
  });

  assert.equal(prompts.length, 2);
  assert.ok(prompts.every(({ options }) => options.source === "rpc"));
  assert.deepEqual(states.map(({ iteration, status }) => [iteration, status]), [
    [1, "active"],
    [2, "active"],
    [2, "blocked"],
  ]);
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /2-continuation safety limit/);
});

test("target mode exits immediately after the goal tool marks completion", async () => {
  const run = promptRuns.beginPromptRun("session-explicit-completion");
  goals.beginGoalRun(run, "Complete after one verified continuation");
  let promptCount = 0;

  const result = await modes.runGoalModeContinuations({
    session: {
      sessionId: run.sessionId,
      prompt: async () => {
        promptCount += 1;
        const tool = promptRuns.requirePromptToolIdentity(run.sessionId, `tool-${promptCount}`);
        goals.addGoalEvidence(tool, "Behavior test observed the requested result");
        goals.completeGoal(tool, "Verified in the behavior test");
      },
    },
    promptRun: run,
    onStateChange: () => {},
  });

  assert.equal(promptCount, 1);
  assert.equal(result.status, "complete");
});
