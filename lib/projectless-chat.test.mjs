import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pathSource = await readFile(new URL("./projectless-chat-path.ts", import.meta.url), "utf8");
const serverSource = await readFile(new URL("./projectless-chat-server.ts", import.meta.url), "utf8");
const readerSource = await readFile(new URL("./session-reader.ts", import.meta.url), "utf8");
const runtimeSource = await readFile(new URL("./session-runtime-resolver.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/chat-workspace/route.ts", import.meta.url), "utf8");

test("projectless chats use a managed workspace and never become project groups", () => {
  assert.match(serverSource, /getAgentDir\(\), "piora", "projectless-chat-workspace"/);
  assert.match(serverSource, /mkdirSync\(cwd, \{ recursive: true \}\)/);
  assert.match(pathSource, /PROJECTLESS_CHAT_PATH_SUFFIX/);
  assert.match(readerSource, /projectless \? \{ projectless: true \}/);
  assert.match(readerSource, /!projectless \? \{ projectRoot:/);
  assert.match(runtimeSource, /isProjectlessChatCwd\(header\.cwd\)/);
  assert.match(runtimeSource, /getProjectlessChatWorkspace\(\)/);
  assert.match(routeSource, /Response\.json\(\{ cwd: getProjectlessChatWorkspace\(\) \}\)/);
});
