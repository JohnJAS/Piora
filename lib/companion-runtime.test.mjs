import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const runtime = await jiti.import("./companion-runtime.ts");

test("companion runtime v1 migrates task capture and focus timer fields without losing todos", () => {
  const migrated = runtime.normalizeCompanionRuntimeState({
    version: 1,
    updatedAt: 10,
    settings: {},
    todos: [{ id: "todo:1", text: "保留待办", completed: false, progress: 20, createdAt: 1, updatedAt: 2 }],
    library: [],
    memories: [],
    mind: {},
  });

  assert.equal(migrated.version, 3);
  assert.equal(migrated.todos[0].text, "保留待办");
  assert.equal(migrated.settings.autoCaptureSessions, true);
  assert.deepEqual(migrated.taskRecords, []);
  assert.equal(migrated.focusTimer.phase, "focus");
  assert.equal(migrated.focusTimer.remainingSeconds, 1_500);
  assert.deepEqual(migrated.focusTimer.durations, { focus: 1_500, "short-break": 300, "long-break": 900 });
  assert.equal(migrated.focusTimer.longBreakEvery, 4);
  assert.equal(migrated.focusTimer.autoStartNextPhase, false);
  assert.equal(migrated.focusTimer.petReminderEnabled, true);
});

test("companion runtime bounds task records and repairs an invalid running timer", () => {
  const normalized = runtime.normalizeCompanionRuntimeState({
    ...runtime.createDefaultCompanionRuntimeState(10),
    taskRecords: [{
      id: "task-record:1",
      sessionId: "session-1",
      sourceEntryId: "entry-1",
      title: " 修复问题 ",
      outcome: " 已完成 ",
      reviewStatus: "confirmed",
      completedAt: 20,
      capturedAt: 21,
      updatedAt: 22,
    }],
    focusTimer: {
      phase: "focus",
      status: "running",
      durations: { focus: 2_400, "short-break": 600, "long-break": 1_800 },
      longBreakEvery: 3,
      autoStartNextPhase: true,
      petReminderEnabled: false,
      durationSeconds: 1_500,
      remainingSeconds: 900,
      startedAt: 10,
      endsAt: null,
      linkedTodoId: null,
      completedFocusSessions: 2,
    },
  });

  assert.equal(normalized.taskRecords[0].title, "修复问题");
  assert.equal(normalized.taskRecords[0].reviewStatus, "confirmed");
  assert.equal(normalized.focusTimer.status, "paused");
  assert.equal(normalized.focusTimer.remainingSeconds, 900);
  assert.equal(normalized.focusTimer.durations.focus, 2_400);
  assert.equal(normalized.focusTimer.longBreakEvery, 3);
  assert.equal(normalized.focusTimer.autoStartNextPhase, true);
  assert.equal(normalized.focusTimer.petReminderEnabled, false);
});
