import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { ExtensionUiBridge } = await jiti.import("../rpc/extension-ui-bridge.ts");

function createBridge() {
  const emitted = [];
  const bridge = new ExtensionUiBridge({
    isAlive: () => true,
    isStopping: () => false,
    getAbortGeneration: () => 0,
    getInner: () => ({}),
    getPermissionParentUi: () => undefined,
    getSubagentUiSignal: () => new AbortController().signal,
    getChatCommandActivity: () => ({ commandId: "cmd-test", phase: () => {}, fail: () => {} }),
    emit: (event) => emitted.push(event),
    applyForcedEmptySystemPrompt: () => {},
  });
  return { bridge, emitted };
}

test("request_user_input pauses auto-resolution when backgrounded and snoozes permanently on user activity", async () => {
  const { bridge, emitted } = createBridge();
  const pending = bridge.requestExtensionUi(
    {
      method: "request_user_input",
      title: "Clarify scope",
      questions: [{ id: "q1", question: "Pick one", kind: "single_select", options: [{ label: "A" }, { label: "B" }], required: true }],
    },
    { cancelled: true },
    (response) => "answers" in response ? { answers: response.answers } : { cancelled: true },
    80,
    undefined,
    { cancelled: true, reason: "timeout" },
  );

  const initial = emitted.find((event) => event.method === "request_user_input");
  assert.ok(initial?.id);
  assert.equal(typeof initial.expiresAt, "number");

  // Backgrounding pauses the countdown before timeout elapses.
  bridge.setUserInputPresented(false);
  const pausedEvent = emitted.findLast((event) => event.method === "request_user_input_state");
  assert.equal(pausedEvent?.paused, true);
  assert.equal(pausedEvent?.snoozed, false);
  assert.equal(pausedEvent?.expiresAt, undefined);

  // Waiting past the original 80ms while backgrounded must NOT time out.
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(bridge.pendingUiRequests.has(initial.id), true);

  // Returning to foreground resumes the timer, then user activity snoozes it.
  bridge.setUserInputPresented(true);
  const resumedEvent = emitted.findLast((event) => event.method === "request_user_input_state");
  assert.equal(resumedEvent?.paused, false);
  assert.equal(typeof resumedEvent?.expiresAt, "number");

  bridge.recordUserInputActivity(initial.id);
  const snoozedEvent = emitted.findLast((event) => event.method === "request_user_input_state");
  assert.equal(snoozedEvent?.snoozed, true);
  assert.equal(snoozedEvent?.expiresAt, undefined);

  // Waiting past the original deadline after snooze must still accept the answer.
  await new Promise((resolve) => setTimeout(resolve, 120));
  bridge.resolveExtensionUiResponse({ type: "extension_ui_response", id: initial.id, answers: { q1: ["A"] } });
  const result = await pending;
  assert.deepEqual(result, { answers: { q1: ["A"] } });
});
