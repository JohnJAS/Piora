import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rpc = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const extension = await readFile(new URL("../extensions/piora-goal.ts", import.meta.url), "utf8");
const input = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
const hook = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const panel = await readFile(new URL("../components/GoalPanel.tsx", import.meta.url), "utf8");
const taskRow = await readFile(new URL("../components/sidebar/TaskRow.tsx", import.meta.url), "utf8");
const staging = await readFile(new URL("../scripts/stage-standalone.mjs", import.meta.url), "utf8");

test("target mode extension exposes terminal states and verification requirements", () => {
  assert.match(extension, /Type\.Literal\("complete"\)/);
  assert.match(extension, /Type\.Literal\("blocked"\)/);
  assert.match(extension, /Type\.Literal\("waiting_user"\)/);
  assert.match(extension, /concrete verification/);
});

test("retired goal UI is no longer exposed in the sidebar", () => {
  assert.match(hook, /case "goal_start"/);
  assert.match(hook, /type: "goal_pause"/);
  assert.match(hook, /type: "goal_cancel"/);
  assert.match(panel, /goal\.successCriteria/);
  assert.match(panel, /goal\.evidence/);
  assert.match(panel, /onResume/);
  assert.doesNotMatch(taskRow, /GoalStatusIndicator|taskStatus\.goal/);
});

test("composer keeps retired target and plan modes disabled", () => {
  assert.match(input, /className="composer-add-menu"/);
  assert.match(input, /promptMode === "goal"/);
  assert.match(input, /promptMode === "plan"/);
  assert.match(input, /goalMode: false, planMode: false/);
  assert.match(input, /goalMode: promptMode === "goal"/);
  assert.match(input, /planMode: promptMode === "plan"/);
  assert.match(input, /setPromptMode\("normal"\)/);
  assert.match(hook, /\.\.\.\(options\?\.goalMode \? \{ goalMode: true \} : \{\}\)/);
  assert.match(hook, /\.\.\.\(options\?\.planMode \? \{ planMode: true \} : \{\}\)/);
});

test("target-mode extension and registry are staged in the unified runtime", () => {
  assert.match(staging, /extensions\/piora-goal\.ts/);
  assert.match(staging, /extensions\/piora-plan\.ts/);
  assert.match(staging, /lib\/prompt-mode-runtime\.ts/);
  assert.match(staging, /lib\/goal-run-registry\.ts/);
  assert.match(rpc, /resolveExtensionLoadPlan/);
  assert.match(rpc, /applyExtensionLoadPlan/);
});

test("target-mode state is session-persistent and exposes lifecycle controls", () => {
  assert.match(extension, /GOAL_RUN_ENTRY_TYPE/);
  assert.match(extension, /api\.appendEntry\(GOAL_RUN_ENTRY_TYPE, state\)/);
  assert.match(extension, /registerCommand\("goal"/);
  assert.match(extension, /status\|pause\|resume\|cancel/);
  assert.match(extension, /Type\.Literal\("evidence"\)/);
  assert.match(extension, /before_agent_start/);
  assert.match(rpc, /restoreGoalRunFromEntries/);
  assert.match(rpc, /pauseActiveGoal/);
});
