import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cards = await readFile(new URL("./StarterCards.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("loads project and git signals only for the new-session empty state", () => {
  assert.match(cards, /\/api\/project-info\?cwd=\$\{encoded\}&starters=1/);
  assert.match(cards, /\/api\/git\/status\?cwd=\$\{encoded\}/);
  assert.match(chat, /isEmptyNew[\s\S]*?<StarterCards/);
});

test("fills the composer without sending", () => {
  const starterUsage = chat.slice(chat.indexOf("<StarterCards"), chat.indexOf("{chatInputElement}", chat.indexOf("<StarterCards")));
  assert.match(starterUsage, /insertIfEmpty\(prompt\)/);
  assert.match(starterUsage, /\.focus\(\)/);
  assert.doesNotMatch(starterUsage, /sendText|handleSend|onSend/);
});
