import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { completedProcessTurns } = await createJiti(import.meta.url).import("./process-completion.ts");

const user = { role: "user", content: "inspect" };
const call = { role: "assistant", content: [{ type: "toolCall", toolCallId: "one", toolName: "bash", input: { command: "ls" } }] };
const result = { role: "toolResult", toolCallId: "one", content: [] };

test("only settled successful turns can auto-collapse", () => {
  assert.deepEqual(completedProcessTurns([user, call, result], true), [false, false, false]);
  assert.deepEqual(completedProcessTurns([user, call, result], false), [true, true, true]);
  for (const tail of [[], [{ ...result, isError: true }], [{ ...result, isStreaming: true }],
    [result, { role: "assistant", content: [], stopReason: "aborted" }]]) {
    assert.ok(completedProcessTurns([user, call, ...tail], false).every(value => !value));
  }
  assert.deepEqual(completedProcessTurns([user, call, result, user], true), [true, true, true, false]);
});

test("unresolved browser handoff remains visible even if the result is not an error", () => {
  const handoff = { role: "assistant", content: [{ type: "toolCall", toolCallId: "one", toolName: "browser", input: { action: "wait_for_user" } }] };
  assert.ok(completedProcessTurns([user, handoff, { ...result, details: { status: "unsupported" } }], false).every(value => !value));
});
