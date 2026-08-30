import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const reminder = await jiti.import("./companion-focus-reminder.ts");
const runtime = await jiti.import("./companion-runtime.ts");

function runningState(overrides = {}) {
  const state = runtime.createDefaultCompanionRuntimeState(1_000);
  return {
    ...state,
    todos: [{ id: "todo:1", text: "修复登录问题", completed: false, progress: 20, createdAt: 1, updatedAt: 1 }],
    focusTimer: {
      ...state.focusTimer,
      status: "running",
      startedAt: 1_000,
      endsAt: 11_000,
      linkedTodoId: "todo:1",
      ...overrides,
    },
  };
}

test("focus reminder ignores a timer that has not expired", () => {
  assert.equal(reminder.completeExpiredCompanionFocusTimer(runningState(), 10_999, () => "ignored"), null);
});

test("focus reminder completes the phase and creates a pet decision", () => {
  const result = reminder.completeExpiredCompanionFocusTimer(runningState(), 11_000, () => "focus-1");
  assert.ok(result);
  assert.equal(result.completedPhase, "focus");
  assert.equal(result.state.focusTimer.phase, "short-break");
  assert.equal(result.state.focusTimer.status, "idle");
  assert.equal(result.decision.id, "decision:focus-1");
  assert.equal(result.decision.event, "timer.focus-completed");
  assert.match(result.decision.speech, /修复登录问题/);
  assert.equal(result.state.mind.lastDecision.id, "decision:focus-1");
});

test("focus reminder can complete silently and preserve automatic phase starts", () => {
  const state = runningState({ petReminderEnabled: false, autoStartNextPhase: true });
  const result = reminder.completeExpiredCompanionFocusTimer(state, 11_000, () => "unused");
  assert.ok(result);
  assert.equal(result.decision, null);
  assert.equal(result.state.mind.lastDecision, null);
  assert.equal(result.state.focusTimer.phase, "short-break");
  assert.equal(result.state.focusTimer.status, "running");
  assert.equal(result.state.focusTimer.endsAt, 311_000);
});
