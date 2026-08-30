import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const runtime = await jiti.import("./companion-runtime.ts");
const store = await jiti.import("./companion-store.ts");

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

test("late legacy migration keeps a model already saved by the companion panel", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-companion-runtime-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const current = runtime.createDefaultCompanionRuntimeState(10);
  current.settings.interactionModel = { provider: "fixture", modelId: "runtime-model" };
  runtime.writeCompanionRuntimeState(current);

  const legacy = store.createDefaultCompanionPreferences();
  legacy.interactionModel = null;
  const migrated = runtime.migrateCompanionPreferences(legacy);

  assert.deepEqual(migrated.settings.interactionModel, { provider: "fixture", modelId: "runtime-model" });
  assert.equal(migrated.migratedFromLocalStorage, true);
});
