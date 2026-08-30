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
const appShellSource = readFileSync(
  new URL("../components/AppShell.tsx", import.meta.url),
  "utf8",
);

test("completion notifications are opt-in and do not inherit the sound preference", () => {
  assert.match(hookSource, /useState\(false\)/);
  assert.match(hookSource, /pi-completion-notifications-enabled/);
  assert.doesNotMatch(hookSource, /pi-sound-enabled/);
  assert.match(hookSource, /Notification\.requestPermission\(\)/);
});

test("desktop notification IPC accepts a sanitized title and bounded Session id", () => {
  assert.match(preloadSource, /notifyCompletion\(taskTitle\?: string, sessionId\?: string\)/);
  assert.match(preloadSource, /pi:completion-notification/);
  assert.match(preloadSource, /pi:notification-session/);
  assert.match(mainSource, /isTrustedCompletionNotificationSender/);
  assert.match(mainSource, /event\.senderFrame !== event\.sender\.mainFrame/);
  assert.match(mainSource, /sanitizeNotificationTaskTitle/);
  assert.match(mainSource, /sanitizeNotificationSessionId/);
  assert.match(mainSource, /MAX_NOTIFICATION_TASK_TITLE_LENGTH = 80/);
  assert.match(mainSource, /MAX_NOTIFICATION_SESSION_ID_LENGTH = 512/);
  assert.doesNotMatch(preloadSource, /messageContent|fileContent|notificationBody/);
});

test("clicking a notification opens its Session in the Piora instance that emitted it", () => {
  assert.match(mainSource, /notification\.on\("click", \(\) => \{[\s\S]*?focusMainWindow\(\)[\s\S]*?webContents\.send\(NOTIFICATION_SESSION_CHANNEL, sessionId\)/);
  assert.match(preloadSource, /onNotificationSession\(listener: \(sessionId: string\) => void\)/);
  assert.match(appShellSource, /onNotificationSession\?\.\(\(sessionId\) =>/);
  assert.match(appShellSource, /fetch\("\/api\/sessions", \{ cache: "no-store" \}\)/);
  assert.match(appShellSource, /handleSelectSession\(session\)/);
  assert.match(appShellSource, /notifyCompletion\(taskTitle, sessionId\)/);
  assert.match(appShellSource, /notifyUserInput\(snapshot\.title \?\? undefined, snapshot\.id\)/);
});

test("desktop and browser notifications use application-owned completion copy", () => {
  assert.match(mainSource, /Task completed\. Open Piora to review the result\./);
  assert.match(hookSource, /Task completed\. Open Piora to review the result\./);
  assert.match(mainSource, /new Notification\(\{ \.\.\.copy, silent: false \}\)/);
  assert.match(hookSource, /tag: "piora-task-complete"/);
  assert.match(hookSource, /notification\.onclick/);
  assert.match(hookSource, /NOTIFICATION_SESSION_EVENT/);
});

test("pending model questions raise an application-owned input notification", () => {
  assert.match(preloadSource, /notifyUserInput\(taskTitle\?: string, sessionId\?: string\)/);
  assert.match(preloadSource, /kind: "user-input"/);
  assert.match(hookSource, /The model asked a question and is waiting for your reply\./);
  assert.match(mainSource, /The model asked a question and is waiting for your reply\./);
  assert.match(hookSource, /tag: "piora-user-input"/);
});

test("a user-stopped run does not emit a successful completion notification", () => {
  assert.match(agentSessionSource, /suppressCompletionNotificationRef\.current = true/);
  assert.match(agentSessionSource, /const shouldNotify = !suppressCompletionNotificationRef\.current/);
  assert.match(agentSessionSource, /if \(shouldNotify && sid\) onAgentEnd\?\.\(sid\)/);
  assert.match(agentSessionSource, /completed\?\.role === "assistant" && completed\.stopReason === "error"/);
  assert.match(agentSessionSource, /case "prompt_error":[\s\S]{0,120}suppressCompletionNotificationRef\.current = true/);
});
