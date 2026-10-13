import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { NestedToolCallsStore } = await createJiti(import.meta.url).import("./nested-tool-calls.ts");
const event = (type, id, parent, extra = {}) => ({ type: `tool_execution_${type}`, toolCallId: id, parentToolCallId: parent, toolName: "fixture", ...extra });

test("parallel and nested calls update only their root subscribers, deduplicated and batched", () => {
  const store = new NestedToolCallsStore(); store.beginRun(1);
  let root = 0, other = 0;
  store.subscribe("root", () => root++); store.subscribe("other", () => other++);
  store.record(event("start", "root/0", "root"), 10);
  store.record(event("start", "root/1", "root"), 12);
  store.record(event("start", "root/0/0", "root/0"), 13);
  store.record(event("start", "root/0", "root"), 14);
  store.record(event("end", "root/1", "root", { isError: true, result: { content: [{ type: "text", text: "failed" }] } }), 20);
  store.record(event("update", "root/0", "root", { partialResult: { content: [{ type: "text", text: "large progress" }] } }));
  store.flush();
  assert.equal(root, 1); assert.equal(other, 0);
  assert.equal(store.getSnapshot("root").calls.length, 3);
  assert.equal(store.getSnapshot("root").calls[1].error, "failed");
  assert.equal(store.getSnapshot("root").calls[1].durationMs, 8);
  store.record(event("end", "root/1", "root", { isError: true }), 100);
  assert.equal(store.getSnapshot("root").calls[1].durationMs, 8, "duplicate ends preserve the original duration and error");
  store.record(event("end", "root/0/0", "root/0"), 22);
  store.finish(); store.flush();
  assert.deepEqual(store.getSnapshot("root").calls.map(call => call.status), ["unfinished", "error", "ok"]);
  assert.equal(store.getSnapshot("root").complete, false);
  store.record(event("end", "root/0", "root"), 120);
  assert.equal(store.getSnapshot("root").calls[0].status, "unfinished", "late completion cannot rewrite a settled run");
  store.beginRun(2); assert.equal(store.getSnapshot("root"), undefined);
  store.reset();
});

test("missing starts and oversized runs remain visibly incomplete", () => {
  const store = new NestedToolCallsStore(); store.beginRun(1);
  store.record(event("end", "r/0", "r"));
  store.record(event("start", "r/0", "r"));
  assert.equal(store.getSnapshot("r").calls[0].status, "ok");
  assert.equal(store.getSnapshot("r").complete, false);
  for (let i = 1; i < 300; i++) store.record(event("start", `r/${i}`, "r"));
  assert.equal(store.getSnapshot("r").calls.length, 256);
  store.reset();
});
