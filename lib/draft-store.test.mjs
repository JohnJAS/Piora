import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const drafts = await jiti.import("./draft-store.ts");

test("command drafts retain independent follow-up, literal mode and delivery options", () => {
  const key = "command-draft";
  drafts.setDraft(key, { value: "/review API", images: [], files: [], commandInput: { afterPrompt: "检查结果", delivery: "steer", inputMode: "auto" } });
  const first = drafts.getDraft(key);
  first.commandInput.afterPrompt = "changed";
  assert.deepEqual(drafts.getDraft(key).commandInput, { afterPrompt: "检查结果", delivery: "steer", inputMode: "auto" });
  drafts.clearDraft(key);
});

test("drafts preserve pasted prompt materials without sharing mutable state", () => {
  const key = "new:C:/project";
  drafts.setDraft(key, {
    value: "summarize this",
    images: [],
    files: [{ name: "粘贴内容 1.txt", size: 12, text: "large paste", kind: "paste" }],
    retryOfPromptIds: ["failed-send"],
  });

  const first = drafts.getDraft(key);
  assert.equal(first.files[0].text, "large paste");
  first.files[0].text = "changed";
  first.retryOfPromptIds.push("different-send");
  assert.equal(drafts.getDraft(key).files[0].text, "large paste");
  assert.deepEqual(drafts.getDraft(key).retryOfPromptIds, ["failed-send"]);

  drafts.clearDraft(key);
  assert.equal(drafts.getDraft(key), null);
});
