import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rpc = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const extension = await readFile(new URL("../extensions/piora-goal.ts", import.meta.url), "utf8");
const input = await readFile(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
const hook = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const staging = await readFile(new URL("../scripts/stage-standalone.mjs", import.meta.url), "utf8");

test("target mode auto-continues until the goal tool reaches a terminal state", () => {
  assert.match(rpc, /command\.goalMode === true/);
  assert.match(rpc, /while \(getGoalRun\(this\.inner\.sessionId\)\?\.status === "active"\)/);
  assert.match(rpc, /await this\.inner\.prompt\(GOAL_MODE_CONTINUATION/);
  assert.match(rpc, /GOAL_MODE_MAX_CONTINUATIONS/);
  assert.match(rpc, /type: "goal_done"/);
  assert.match(extension, /Type\.Literal\("complete"\)/);
  assert.match(extension, /Type\.Literal\("blocked"\)/);
  assert.match(extension, /verifying the requested outcome/);
});

test("composer exposes a persistent target-mode toggle and sends it with prompts", () => {
  assert.match(input, /piora-goal-mode-enabled/);
  assert.match(input, /aria-pressed=\{goalMode\}/);
  assert.match(input, /goalMode: goalMode/);
  assert.match(hook, /\.\.\.\(options\?\.goalMode \? \{ goalMode: true \} : \{\}\)/);
});

test("target-mode extension and registry are staged and admitted to device-control", () => {
  assert.match(staging, /extensions\/piora-goal\.ts/);
  assert.match(staging, /lib\/goal-run-registry\.ts/);
  assert.match(rpc, /bundledGoalExtension/);
});
