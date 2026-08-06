import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hookSource = readFileSync(
  new URL("./useCompletionNotification.ts", import.meta.url),
  "utf8",
);
const mainSource = readFileSync(
  new URL("../desktop/src/main.ts", import.meta.url),
  "utf8",
);
const preloadSource = readFileSync(
  new URL("../desktop/src/preload.ts", import.meta.url),
  "utf8",
);
const agentSessionSource = readFileSync(
  new URL("./useAgentSession.ts", import.meta.url),
  "utf8",
);

test("completion notifications are opt-in and do not inherit the sound preference", () => {
  assert.match(hookSource, /useState\(false\)/);
  assert.match(hookSource, /pi-completion-notifications-enabled/);
  assert.doesNotMatch(hookSource, /pi-sound-enabled/);
  assert.match(hookSource, /Notification\.requestPermission\(\)/);
});

test("desktop notification IPC accepts only a sanitized task title", () => {
  assert.match(preloadSource, /notifyCompletion\(taskTitle\?: string\)/);
  assert.match(preloadSource, /pi:completion-notification/);
  assert.match(mainSource, /isTrustedCompletionNotificationSender/);
  assert.match(mainSource, /event\.senderFrame !== event\.sender\.mainFrame/);
  assert.match(mainSource, /sanitizeNotificationTaskTitle/);
  assert.match(mainSource, /MAX_NOTIFICATION_TASK_TITLE_LENGTH = 80/);
  assert.doesNotMatch(preloadSource, /messageContent|fileContent|notificationBody/);
});

test("desktop and browser notifications use application-owned completion copy", () => {
  assert.match(mainSource, /Task completed\. Open Piora to review the result\./);
  assert.match(hookSource, /Task completed\. Open Piora to review the result\./);
  assert.match(mainSource, /new Notification\(\{ \.\.\.copy, silent: false \}\)/);
  assert.match(hookSource, /tag: "pigui-task-complete"/);
});

test("a user-stopped run does not emit a successful completion notification", () => {
  assert.match(agentSessionSource, /suppressCompletionNotificationRef\.current = true/);
  assert.match(agentSessionSource, /const shouldNotify = !suppressCompletionNotificationRef\.current/);
  assert.match(agentSessionSource, /if \(shouldNotify\) onAgentEnd\?\.\(\)/);
  assert.match(agentSessionSource, /completed\?\.role === "assistant" && completed\.stopReason === "error"/);
  assert.match(agentSessionSource, /case "prompt_error":[\s\S]{0,120}suppressCompletionNotificationRef\.current = true/);
});
