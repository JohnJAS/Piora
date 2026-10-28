import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { mergePendingPrompts, savePendingPrompt, replaceFailedPromptMessage } = await jiti.import("./prompt-recovery.ts");
const { prepareMessageRetry } = await jiti.import("./message-retry.ts");
const { buildChatHistoryRows } = await jiti.import("./chat-history.ts");
const draft = { value: "  原文\n".repeat(10000), images: [{ data: "YWJj", mimeType: "image/png" }], files: [{ name: "材料.txt", size: 9, text: "完整附件", kind: "file" }] };
const pending = { id: "send-one", scope: "session-one", message: { role: "user", content: "预览", timestamp: 1 }, draft };

test("stop, model change and repeated empty history reloads retain full text and attachments", async () => {
  for (let reload = 0; reload < 3; reload++) {
    const result = mergePendingPrompts([], [], [structuredClone(pending)]);
    assert.equal(result.messages.length, 1);
    assert.deepEqual(result.confirmedIds, []);
    const retry = await prepareMessageRetry(result.messages[0], () => { throw new Error("must use full recovery bytes"); });
    assert.equal(retry.message, draft.value);
    assert.deepEqual(retry.files, draft.files);
    assert.equal(retry.images[0].data, draft.images[0].data);
  }
});
test("same-text sends remain separate; live receipts cannot delete backup; disk receipts cover other branches", () => {
  const sameText = { role: "user", content: "预览", clientPromptId: "another-send" };
  assert.equal(mergePendingPrompts([sameText], ["entry"], [pending]).messages.length, 2);
  const live = { ...sameText, clientPromptId: pending.id };
  assert.deepEqual(mergePendingPrompts([live], ["entry"], [pending]).confirmedIds, []);
  assert.equal(mergePendingPrompts([live], ["entry"], [pending]).messages.length, 1);
  const disk = mergePendingPrompts([], [], [pending], [pending.id]);
  assert.deepEqual(disk.confirmedIds, [pending.id]);
  assert.equal(disk.messages.length, 0);
});
test("unavailable durable storage rejects admission instead of allowing composer deletion", async () => {
  await assert.rejects(savePendingPrompt(pending), /无法保存发送恢复副本/);
});
test("multiple recovered messages have distinct virtual row identities", () => {
  const result = mergePendingPrompts([], [], [pending, { ...pending, id: "send-two" }]);
  const { rows } = buildChatHistoryRows(result.messages, result.entryIds, false, new Set());
  assert.equal(new Set(rows.map((row) => row.key)).size, 2);
});

test("recovery copies return to send-time positions without reordering stored history", () => {
  const disk = [{ role: "user", content: "earlier", timestamp: 5 }, { role: "assistant", content: [], timestamp: 20 }, { role: "user", content: "later", timestamp: 40 }];
  const old = { ...pending, id: "old", message: { ...pending.message, timestamp: 1 } };
  const middle = { ...pending, id: "middle", message: { ...pending.message, timestamp: 30 } };
  const result = mergePendingPrompts(disk, ["one", "two", "three"], [middle, old]);
  assert.deepEqual(result.messages.map(message => message.timestamp), [1, 5, 20, 30, 40]);
  assert.deepEqual(result.entryIds, ["", "one", "two", "", "three"]);
  assert.equal(result.messages[0].sendUnconfirmed, true);
  assert.deepEqual(result.confirmedIds, [], "placement never counts as delivery confirmation");
});

test("a disk-confirmed retry retires its failed chain but never unrelated same-text sends", async () => {
  const retry = { ...pending, id: "retry", draft: { ...draft, retryOfPromptIds: [pending.id] } };
  const final = { ...pending, id: "final", draft: { ...draft, retryOfPromptIds: [retry.id] } };
  const unrelated = { ...pending, id: "independent" };
  const records = [pending, retry, final, unrelated];
  const liveMessage = { ...pending.message, clientPromptId: final.id };
  assert.deepEqual(mergePendingPrompts([liveMessage], ["entry"], records).confirmedIds, [], "live output is not a disk receipt");
  const result = mergePendingPrompts([liveMessage], ["entry"], records, [final.id]);
  assert.deepEqual(result.confirmedIds, [pending.id, retry.id, final.id]);
  assert.deepEqual(result.messages.map(message => message.clientPromptId), [final.id, unrelated.id]);
  assert.deepEqual(result.entryIds, ["entry", ""]);
  const restored = mergePendingPrompts([], [], [retry]).messages[0];
  const payload = await prepareMessageRetry(restored, async () => "");
  assert.deepEqual(payload.retryOfPromptIds, [retry.id, pending.id]);
});

test("branch-bound recovery survives reloads without leaking into a sibling branch, while disk receipts still settle it", () => {
  const old = { ...pending, branchAnchorId: "old-leaf" };
  const current = { ...pending, id: "current-send", branchAnchorId: "parent" };
  assert.deepEqual(mergePendingPrompts([], ["parent"], [old, current]).messages.map(message => message.clientPromptId), ["current-send"]);
  assert.deepEqual(mergePendingPrompts([], ["parent", "old-leaf"], [old, current]).messages.map(message => message.clientPromptId), [pending.id, "current-send"]);
  assert.deepEqual(mergePendingPrompts([], ["parent"], [old], [old.id]).confirmedIds, [old.id]);
});

test("edited failures replace their linked row through repeated failures and reload while preserving unrelated identical sends", () => {
  const old = { ...pending, message: { role: "user", content: "old", timestamp: 10 } };
  const unrelated = { ...pending, id: "unrelated", message: { role: "user", content: "old", timestamp: 20 } };
  const retry = { ...pending, id: "retry", message: { role: "user", content: "edited", timestamp: 30 }, draft: { ...draft, value: "edited", retryOfPromptIds: [old.id] } };
  const final = { ...retry, id: "final", message: { role: "user", content: "edited again", timestamp: 40 }, draft: { ...draft, value: "edited again", retryOfPromptIds: [retry.id, old.id] } };
  for (const records of [[old, unrelated, retry], [old, unrelated, retry, final]]) {
    const result = mergePendingPrompts([], [], records);
    assert.deepEqual(result.messages.map(message => message.clientPromptId), [records.at(-1).id, unrelated.id]);
    assert.deepEqual(result.confirmedIds, []);
    assert.equal(result.messages[0].recoveryDraft.value, records.at(-1).draft.value);
  }
  const initial = mergePendingPrompts([], [], [old, unrelated]);
  const replacement = replaceFailedPromptMessage(initial.messages, initial.entryIds, { ...retry.message, clientPromptId: retry.id, recoveryDraft: retry.draft });
  assert.deepEqual(replacement.messages.map(message => message.clientPromptId), [retry.id, unrelated.id]);
  assert.deepEqual(replacement.entryIds, ["", ""]);
  const persisted = { role: "user", content: "stored", clientPromptId: old.id };
  const untouched = replaceFailedPromptMessage([persisted], ["entry"], { ...retry.message, clientPromptId: retry.id, recoveryDraft: retry.draft });
  assert.deepEqual(untouched.entryIds, ["entry", ""]);
});
