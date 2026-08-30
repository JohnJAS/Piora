import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cards = await readFile(new URL("./StarterCards.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const launcher = await readFile(new URL("./NewSessionLauncher.tsx", import.meta.url), "utf8");
const projectInfoRoute = await readFile(new URL("../app/api/project-info/route.ts", import.meta.url), "utf8");

test("loads lightweight project signals for starter suggestions", () => {
  assert.match(cards, /\/api\/project-info\?cwd=\$\{encoded\}&starters=fast/);
  assert.match(cards, /\/api\/git\/status\?cwd=\$\{encoded\}/);
  assert.match(projectInfoRoute, /includeOutdatedDependencies: request\.nextUrl\.searchParams\.get\("starters"\) !== "fast"/);
  assert.match(cards, /signalSnapshot\.cwd === normalizedCwd/);
  assert.match(cards, /cwd: requestCwd/);
});

test("shares the same launch surface and suggestions before and after project selection", () => {
  assert.match(chat, /<NewSessionLauncher/);
  assert.match(launcher, /<StarterCards/);
  assert.doesNotMatch(chat, /NEXT_PUBLIC_(?:APP|PI)_VERSION/);
  assert.doesNotMatch(chat, /开始一个新会话|new-session-chat-mark/);
  assert.match(launcher, /t\("newSession\.title"\)/);
});
