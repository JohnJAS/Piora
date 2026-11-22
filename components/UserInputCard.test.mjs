import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [wrapperCard, inlineCard, pendingPanel, dock, styles, chat, rpc] = await Promise.all([
  readFile(new URL("./UserInputCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("./workflow/InlineUserInputCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("./workflow/ComposerPendingRequestPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("./workflow/ChatWorkflowDock.tsx", import.meta.url), "utf8"),
  readFile(new URL("./workflow/Workflow.module.css", import.meta.url), "utf8"),
  readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/rpc/extension-ui-bridge.ts", import.meta.url), "utf8"),
]);

test("structured input card renders inline in the composer with choices, text, pagination, cancellation, and keyboard submission", () => {
  assert.match(wrapperCard, /InlineUserInputCard/);
  assert.match(inlineCard, /data-testid="inline-user-input-card"/);
  assert.doesNotMatch(inlineCard, /createPortal/);
  assert.match(inlineCard, /single_select/);
  assert.match(inlineCard, /toggleMultiple/);
  assert.match(inlineCard, /currentQuestion\.multiline/);
  assert.match(inlineCard, /aria-checked=\{checked\}/);
  assert.match(inlineCard, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(inlineCard, /\^\[1-6\]\$/);
  assert.match(inlineCard, /onRespond\(request, \{ answers: mergedAnswers \}\)/);
  assert.match(inlineCard, /cancelled: true/);
  assert.match(chat, /extensionDialog\?\.method === "request_user_input"/);
  assert.match(dock, /ComposerPendingRequestPanel/);
  assert.match(pendingPanel, /InlineUserInputCard/);
});

test("select questions offer a custom Other answer merged into the submitted payload", () => {
  assert.match(inlineCard, /userInput\.otherPlaceholder/);
  assert.match(inlineCard, /const customActive = customValue\.trim\(\)\.length > 0;/);
  assert.match(inlineCard, /setCustom\(currentQuestion\.id, event\.target\.value, currentQuestion\.kind === "single_select"\)/);
  assert.match(inlineCard, /if \(custom\) values\.push\(custom\);/);
  // A single-select custom answer replaces the chosen label; the merged
  // payload never carries both at once.
  assert.match(inlineCard, /const mergedAnswers = useMemo<UserInputAnswers>/);
  assert.match(inlineCard, /replaces any chosen option label/);
  assert.match(styles, /\.customField/);
  assert.match(inlineCard, /USER_INPUT_MAX_TEXT_LENGTH/);
});

test("inline card persists drafts, reports foreground presence, snoozes auto-resolution, and RPC bridge returns answers", () => {
  assert.match(inlineCard, /getUserInputDraft/);
  assert.match(inlineCard, /setUserInputDraft/);
  assert.match(inlineCard, /user_input_presence/);
  assert.match(inlineCard, /user_input_activity/);
  assert.match(inlineCard, /data-user-input-auto-resolution/);
  assert.match(styles, /var\(--border-soft\)/);
  assert.match(styles, /var\(--surface-raised\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(rpc, /requestUserInput: \(title, description, questions, opts\)/);
  assert.match(rpc, /"answers" in response \? \{ answers: response\.answers \}/);
  assert.match(rpc, /setUserInputPresented/);
  assert.match(rpc, /recordUserInputActivity/);
});
