import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cards = await readFile(new URL("./StarterCards.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("keeps starter suggestions available as an isolated component", () => {
  assert.match(cards, /\/api\/project-info\?cwd=\$\{encoded\}&starters=1/);
  assert.match(cards, /\/api\/git\/status\?cwd=\$\{encoded\}/);
});

test("does not render suggestion prompts above the new-session composer", () => {
  assert.doesNotMatch(chat, /<StarterCards/);
  assert.doesNotMatch(chat, /NEXT_PUBLIC_(?:APP|PI)_VERSION/);
  assert.match(chat, /开始一个新会话/);
  assert.match(chat, /设置 → 智能体 → 模型/);
  assert.match(chat, /顶部项目菜单/);
  assert.doesNotMatch(chat, /你想在|中构建什么/);
});
