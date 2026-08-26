import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { AutomationStore } = await jiti.import("./automation-store.ts");
const { AutomationRuntime } = await jiti.import("./automation-runtime.ts");

async function waitFor(predicate, timeout = 3_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for automation runtime state");
}

test("manual project runs persist a terminal failure instead of disappearing", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-automation-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new AutomationStore(root);
  const missingCwd = path.join(root, "missing-project");
  const automation = await store.create({
    kind: "cron", name: "Missing project", prompt: "Inspect it.",
    rrule: "RRULE:FREQ=HOURLY;INTERVAL=1", timezone: "UTC",
    target: { type: "project", cwd: missingCwd }, notificationPolicy: "failed_runs_only",
  });
  const runtime = new AutomationRuntime({ store, disableTimer: true });
  const accepted = await runtime.runNow(automation.id);
  assert.equal(accepted.status, "queued");
  const failed = await waitFor(() => store.listRuns(automation.id).find((run) => run.id === accepted.id && run.status === "failed"));
  assert.match(failed.error, /does not exist|ENOENT/);
  assert.equal(store.pendingNotifications()[0].status, "failed");
});

test("a delayed scheduler catches up once, advances past now, and does not burst", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-automation-catchup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new AutomationStore(root);
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  let now = base;
  const automation = await store.create({
    kind: "cron", name: "Catch up", prompt: "Inspect it.",
    rrule: "RRULE:FREQ=MINUTELY;INTERVAL=5", timezone: "UTC",
    target: { type: "project", cwd: path.join(root, "missing-project") }, notificationPolicy: "never",
  }, base);
  assert.equal(automation.nextRunAt, base + 5 * 60_000);

  now = base + 32 * 60_000;
  const runtime = new AutomationRuntime({ store, now: () => now, disableTimer: true });
  await runtime.tick();
  await waitFor(() => store.listRuns(automation.id)[0]?.status === "failed");
  assert.equal(store.listRuns(automation.id).length, 1);
  assert.equal(store.pendingNotifications().length, 0);
  const advanced = store.get(automation.id);
  assert.ok(advanced.nextRunAt > now);
  assert.ok(advanced.nextRunAt <= now + 5 * 60_000);

  await runtime.tick();
  assert.equal(store.listRuns(automation.id).length, 1);
});
