import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  TASK_ACTIVITY_MAX_LENGTH,
  activityFromMessage,
  compactTaskActivityText,
} = await createJiti(import.meta.url).import("./rpc-task-activity.ts");

test("task activity text is compact, bounded, and keeps the newest detail", () => {
  assert.equal(compactTaskActivityText("  one\n two  "), "one two");
  const result = compactTaskActivityText(`old-${"x".repeat(300)}-new`);
  assert.equal(result.length, TASK_ACTIVITY_MAX_LENGTH);
  assert.equal(result.startsWith("…"), true);
  assert.equal(result.endsWith("-new"), true);
});

test("task activity selects the newest renderable message block", () => {
  assert.deepEqual(activityFromMessage({ content: "hello" }), {
    kind: "assistant",
    message: "hello",
  });
  assert.deepEqual(activityFromMessage({
    content: [
      { type: "text", text: "older" },
      { type: "thinking", thinking: "newer thought" },
    ],
  }), {
    kind: "thinking",
    message: "newer thought",
  });
  assert.deepEqual(activityFromMessage({
    content: [{ type: "toolCall", name: "read", arguments: { path: "file.ts" } }],
  }), {
    kind: "tool",
    message: 'read: {"path":"file.ts"}',
  });
  assert.equal(activityFromMessage({ content: [] }), null);
});
