import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../", import.meta.url)) } });
const { SessionControlStore } = await jiti.import("./session-control-store.ts");
const { GET } = await jiti.import("../app/api/sessions/[id]/submissions/route.ts");

test("cancelled submissions remain recoverable without a live runtime or session history", async () => {
  const root = await mkdtemp(join(tmpdir(), "piora-submissions-"));
  const previous = process.env.PIORA_SESSION_CONTROL_ROOT;
  process.env.PIORA_SESSION_CONTROL_ROOT = root;
  try {
    const store = new SessionControlStore({ root });
    const command = { commandId: "lost-send", idempotencyKey: "original-send", targetSessionId: "orphan", source: "ui", content: "完整原文\n".repeat(20000), images: [{ type: "image", data: "YWJj", mimeType: "image/png" }], delivery: "next_turn", acceptedAt: 1, status: "cancelled" };
    await store.appendCommand(command);
    await store.compact("orphan");
    const params = { params: Promise.resolve({ id: "orphan" }) };
    const listing = await GET(new Request("http://localhost/api/sessions/orphan/submissions"), params);
    const summary = await listing.json();
    assert.equal(summary.items[0].id, "lost-send");
    assert.ok(summary.items[0].preview.length <= 180);
    const detail = await GET(new Request("http://localhost/api/sessions/orphan/submissions?commandId=lost-send"), params);
    assert.deepEqual(await detail.json(), { value: command.content, images: [{ data: "YWJj", mimeType: "image/png" }], files: [] });
  } finally {
    if (previous === undefined) delete process.env.PIORA_SESSION_CONTROL_ROOT; else process.env.PIORA_SESSION_CONTROL_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("latest completed task timing restores separately without replaying ordinary completion cards", async () => {
  const root = await mkdtemp(join(tmpdir(), "piora-submissions-timing-"));
  const previous = process.env.PIORA_SESSION_CONTROL_ROOT;
  process.env.PIORA_SESSION_CONTROL_ROOT = root;
  try {
    const taskTiming = { commandId: "timed", sessionId: "timing", startedAt: 1000, finishedAt: 85000, outcome: "completed" };
    const store = new SessionControlStore({ root });
    await store.appendCommand({ commandId: "timed", idempotencyKey: "timed", targetSessionId: "timing", source: "ui", content: "ordinary prompt", delivery: "next_turn", acceptedAt: 1, status: "completed", taskTiming });
    const response = await GET(new Request("http://localhost/api/sessions/timing/submissions?view=operations"), { params: Promise.resolve({ id: "timing" }) });
    const body = await response.json();
    assert.deepEqual(body.taskTiming, taskTiming);
    assert.deepEqual(body.taskTimings, [{ idempotencyKey: "timed", taskTiming }]);
    assert.deepEqual(body.items, []);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const params = { params: Promise.resolve({ id: "timing" }) };
    const later = { ...taskTiming, commandId: "later", startedAt: 90_000, finishedAt: 91_000 };
    await store.appendCommand({ commandId: "later", idempotencyKey: "latest-send", targetSessionId: "timing", source: "ui",
      content: "latest", delivery: "next_turn", acceptedAt: 2, status: "completed", taskTiming: later });
    const bounded = await GET(new Request("http://localhost/api/sessions/timing/submissions?view=operations&scope=chat&timingPromptId=timed"), params);
    assert.deepEqual(await bounded.json(), { taskTiming: later, taskTimings: [{ idempotencyKey: "timed", taskTiming }], items: [], nextOffset: null });
    const past = await GET(new Request("http://localhost/api/sessions/timing/submissions?view=timings&timingPromptId=timed"), params);
    assert.deepEqual(await past.json(), { taskTimings: [{ idempotencyKey: "timed", taskTiming }] });
  } finally {
    if (previous === undefined) delete process.env.PIORA_SESSION_CONTROL_ROOT; else process.env.PIORA_SESSION_CONTROL_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
