import assert from "node:assert/strict";
import test from "node:test";

const prompts = await import("./prompt-run-registry.ts");
const { assertSharedRoomReplyAllowed } = await import("./room-prompt-auth.ts");

test.afterEach(() => prompts.resetPromptRunRegistryForTests());

test("direct Session prompts cannot write replies into a Room", () => {
  prompts.beginPromptRun("session-a", { source: "ui" });
  assert.throws(
    () => assertSharedRoomReplyAllowed("session-a", "room-a"),
    /Direct Session chats remain private/,
  );
});

test("a Room-dispatched prompt can reply only to its originating Room", () => {
  prompts.beginPromptRun("session-a", {
    source: "room",
    roomContext: { roomId: "room-a", messageId: "message-a" },
  });
  assert.doesNotThrow(() => assertSharedRoomReplyAllowed("session-a", "room-a"));
  assert.throws(() => assertSharedRoomReplyAllowed("session-a", "room-b"), /only allowed/);
});
