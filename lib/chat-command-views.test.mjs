import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { mergeChatCommandViews, recoverChatCommandViews } = await jiti.import("./chat-command-views.ts");
const { createChatCommandCatalog } = await jiti.import("./chat-command-input.ts");
const view = { commandId: "server-1", idempotencyKey: "submission-1", targetSessionId: "session", acceptedAt: 10, status: "completed" };

test("recovery and server snapshots reconcile in either arrival order without duplicate cards", () => {
  const local = { ...view, commandId: "pending-submission-1", status: "interrupted", local: true };
  assert.deepEqual(mergeChatCommandViews([view], [local]), [view]);
  assert.deepEqual(mergeChatCommandViews([local], [view]), [view]);
});

test("late admission receipts cannot regress terminal command results", () => {
  const completed = { ...view, operation: { result: { title: "done" } } };
  assert.deepEqual(mergeChatCommandViews([completed], [{ ...view, status: "accepted" }]), [completed]);
  const distinct = { ...view, commandId: "server-2", idempotencyKey: "submission-2" };
  assert.equal(mergeChatCommandViews([view], [distinct]).length, 2);
});

test("unconfirmed command recovery retains original text, follow-up and attachment count", () => {
  const draft = { value: "/reload 检查结果", images: [{ data: "image", mimeType: "image/png" }], files: [], commandInput: {} };
  const pending = { id: "submission-1", scope: "session", draft, message: { role: "user", content: draft.value, timestamp: 10, commandSubmission: true } };
  const recovered = recoverChatCommandViews([pending, { ...pending, id: "normal", message: { ...pending.message, commandSubmission: false } }], createChatCommandCatalog([]), "session");
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].operation.rawText, draft.value);
  assert.equal(recovered[0].operation.afterPrompt, "检查结果");
  assert.equal(recovered[0].attachments, 1);
  assert.equal(recovered[0].status, "interrupted");
  assert.equal(recovered[0].targetSessionId, "session");
});

test("older disk snapshots and late receipts cannot regress live nonterminal progress", () => {
  const running = { ...view, status: "running", revision: 5, operation: { phase: "model" } };
  const older = { ...view, status: "queued", revision: 3, operation: { phase: "queued" } };
  assert.deepEqual(mergeChatCommandViews([running], [older]), [running]);
  assert.deepEqual(mergeChatCommandViews([running], [{ ...view, status: "accepted" }]), [running]);
  const completed = { ...view, revision: 6, operation: { phase: "settling" } };
  assert.deepEqual(mergeChatCommandViews([running], [completed]), [completed]);
});

test("unavailable extension catalogs still retain recoverable raw commands", () => {
  const draft = { value: "/custom 中文参数", images: [], files: [] };
  const recovered = recoverChatCommandViews([{ id: "custom", scope: "new", draft, message: { role: "user", commandSubmission: true, timestamp: 20 } }], createChatCommandCatalog([]), null);
  assert.equal(recovered[0].preview, draft.value);
  assert.equal(recovered[0].local, true);
});
