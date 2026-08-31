import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const timer = await jiti.import("./companion-focus-timer.ts");

function focusTimer(overrides = {}) {
  return {
    phase: "focus",
    status: "idle",
    durations: { focus: 1_500, "short-break": 300, "long-break": 900 },
    longBreakEvery: 4,
    autoStartNextPhase: false,
    petReminderEnabled: true,
    durationSeconds: 1_500,
    remainingSeconds: 1_500,
    startedAt: null,
    endsAt: null,
    linkedTodoId: null,
    completedFocusSessions: 0,
    ...overrides,
  };
}

test("focus timer starts, pauses, and restores remaining wall-clock time", () => {
  const started = timer.startCompanionFocusTimer(focusTimer(), 10_000);
  assert.equal(started.status, "running");
  assert.equal(started.endsAt, 1_510_000);
  assert.equal(timer.getCompanionFocusRemainingSeconds(started, 70_000), 1_440);

  const paused = timer.pauseCompanionFocusTimer(started, 70_000);
  assert.equal(paused.status, "paused");
  assert.equal(paused.remainingSeconds, 1_440);
  assert.equal(paused.endsAt, null);
});

test("focus completion selects breaks and uses a long break every fourth tomato", () => {
  const first = timer.completeCompanionFocusTimer(focusTimer());
  assert.equal(first.phase, "short-break");
  assert.equal(first.remainingSeconds, 300);
  assert.equal(first.completedFocusSessions, 1);

  const fourth = timer.completeCompanionFocusTimer(focusTimer({ completedFocusSessions: 3 }));
  assert.equal(fourth.phase, "long-break");
  assert.equal(fourth.remainingSeconds, 900);
  assert.equal(fourth.completedFocusSessions, 4);

  const afterBreak = timer.completeCompanionFocusTimer({ ...fourth, phase: "long-break" });
  assert.equal(afterBreak.phase, "focus");
  assert.equal(afterBreak.completedFocusSessions, 4);
});

test("focus timer uses adjustable durations and long-break intervals", () => {
  const configured = timer.updateCompanionFocusDuration(focusTimer(), "focus", 42 * 60);
  assert.equal(configured.durations.focus, 42 * 60);
  assert.equal(configured.durationSeconds, 42 * 60);
  assert.equal(configured.remainingSeconds, 42 * 60);

  const second = timer.completeCompanionFocusTimer(focusTimer({
    completedFocusSessions: 1,
    longBreakEvery: 2,
    durations: { focus: 2_520, "short-break": 420, "long-break": 1_200 },
  }));
  assert.equal(second.phase, "long-break");
  assert.equal(second.remainingSeconds, 1_200);
});

test("focus timer can automatically start the next phase", () => {
  const completed = timer.completeCompanionFocusTimer(focusTimer({ autoStartNextPhase: true }), 20_000);
  assert.equal(completed.phase, "short-break");
  assert.equal(completed.status, "running");
  assert.equal(completed.startedAt, 20_000);
  assert.equal(completed.endsAt, 320_000);
});

test("pet presentation reflects running and paused focus timers", () => {
  assert.equal(timer.getCompanionFocusPetPresentation(focusTimer(), 10_000), null);
  const running = timer.startCompanionFocusTimer(focusTimer(), 10_000);
  assert.deepEqual(timer.getCompanionFocusPetPresentation(running, 70_000), {
    phase: "focus",
    status: "running",
    remainingSeconds: 1_440,
  });
  assert.equal(timer.formatCompanionFocusCountdown(1_440), "24:00");
  const paused = timer.pauseCompanionFocusTimer(running, 70_000);
  assert.equal(timer.getCompanionFocusPetPresentation(paused, 999_000)?.status, "paused");
});
