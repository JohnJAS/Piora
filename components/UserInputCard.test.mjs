import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [card, styles, chat, rpc] = await Promise.all([
  readFile(new URL("./UserInputCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("./UserInputCard.module.css", import.meta.url), "utf8"),
  readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/rpc-manager.ts", import.meta.url), "utf8"),
]);

test("structured input card supports choices, text, cancellation, and keyboard submission", () => {
  assert.match(card, /role="dialog"/);
  assert.match(card, /useFocusTrap/);
  assert.match(card, /single_select/);
  assert.match(card, /toggleMultiple/);
  assert.match(card, /question\.multiline/);
  assert.match(card, /aria-checked=\{checked\}/);
  assert.match(card, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(card, /onRespond\(request, \{ answers \}\)/);
  assert.match(card, /cancelled: true/);
  assert.match(chat, /extensionDialog\?\.method === "request_user_input"/);
});

test("card uses the shared Codex surface tokens and the RPC bridge returns answers", () => {
  assert.match(styles, /var\(--overlay-scrim\)/);
  assert.match(styles, /var\(--border-soft\)/);
  assert.match(styles, /var\(--surface-raised\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(rpc, /requestUserInput: \(title, description, questions, opts\)/);
  assert.match(rpc, /"answers" in response \? \{ answers: response\.answers \}/);
});
