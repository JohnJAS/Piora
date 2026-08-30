import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { AutomationStore } = await jiti.import("./automation-store.ts");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-automation-store-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new AutomationStore(root);
}

test("persists, edits, pauses, and deletes a chat heartbeat", async (t) => {
  const store = fixture(t);
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const created = await store.create({
    kind: "heartbeat", name: "Monitor release", prompt: "Check the release.",
    rrule: "RRULE:FREQ=MINUTELY;INTERVAL=5", timezone: "UTC",
    target: { type: "session", sessionId: "session-1", cwd: process.cwd() },
  }, now);
  assert.equal(created.id, "monitor-release");
  assert.equal(created.nextRunAt, now + 5 * 60_000);
  assert.equal(store.list()[0].prompt, "Check the release.");

  const updated = await store.update(created.id, { status: "PAUSED", prompt: "Check and report." }, now + 1_000);
  assert.equal(updated.status, "PAUSED");
  assert.equal(updated.nextRunAt, null);
  assert.equal(updated.prompt, "Check and report.");
  assert.equal(await store.remove(created.id), true);
  assert.equal(store.list().length, 0);
});

test("records bounded run history, interruption recovery, and notification acknowledgement", async (t) => {
  const store = fixture(t);
  const automation = await store.create({
    kind: "cron", name: "Project check", prompt: "Inspect the project.",
    rrule: "RRULE:FREQ=HOURLY;INTERVAL=1", timezone: "UTC",
    target: { type: "project", cwd: process.cwd() },
  }, 1_800_000_000_000);
  const run = await store.startRun(automation.id, 1_800_000_000_000, 1_800_000_000_000);
  await store.updateRun(run.id, { status: "running", startedAt: 1_800_000_000_001 });
  assert.equal(await store.recoverInterrupted(1_800_000_000_100), 1);
  assert.equal(store.listRuns(automation.id)[0].status, "interrupted");

  await store.addNotification({ id: "notice-1", automationId: automation.id, runId: run.id, sessionId: "session-1", title: automation.name, status: "interrupted", createdAt: 1 });
  assert.equal(store.pendingNotifications().length, 1);
  assert.equal(store.pendingNotifications()[0].sessionId, "session-1");
  assert.equal(await store.acknowledgeNotifications(["notice-1"], 2), 1);
  assert.equal(store.pendingNotifications().length, 0);
});

test("rejects mismatched targets and invalid recurrence rules", async (t) => {
  const store = fixture(t);
  await assert.rejects(store.create({ kind: "heartbeat", name: "Bad", prompt: "No", rrule: "RRULE:FREQ=MINUTELY", timezone: "UTC", target: { type: "project", cwd: process.cwd() } }), /Session target/);
  await assert.rejects(store.create({ kind: "cron", name: "Bad", prompt: "No", rrule: "not a rule", timezone: "UTC", target: { type: "project", cwd: process.cwd() } }), /RRULE/);
});
