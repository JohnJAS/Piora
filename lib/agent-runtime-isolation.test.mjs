import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rpc = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");
const existingRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
const eventsRoute = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
const staging = await readFile(new URL("../scripts/stage-standalone.mjs", import.meta.url), "utf8");

test("device-control constructs an allow-listed resource loader and tool registry", () => {
  assert.match(rpc, /runtimeProfile === "device-control"/);
  assert.match(rpc, /toolsOption = toolNames \?\? \[\.\.\.DEVICE_CONTROL_AGENT_TOOLS\]/);
  assert.match(rpc, /additionalExtensionPaths: \[bundledHarmonyExtension, bundledGoalExtension\]/);
  assert.match(rpc, /noExtensions: true/);
  assert.match(rpc, /noSkills: true/);
  assert.match(rpc, /noPromptTemplates: true/);
  assert.match(rpc, /noThemes: true/);
  assert.match(rpc, /noContextFiles: true/);
  assert.match(rpc, /systemPromptOverride: \(\) => undefined/);
  assert.match(rpc, /appendSystemPromptOverride: \(\) => \[\]/);
  assert.match(rpc, /loadedPaths\.length !== expectedPaths\.length/);
  assert.match(rpc, /DEVICE_CONTROL_DENIED_RPC_COMMANDS/);
  assert.match(rpc, /if \(runtimeProfile === "normal"\) ensureWindowsBashShellPath/);
});

test("ordinary sessions load every first-party extension alongside coding tools", () => {
  assert.match(
    rpc,
    /additionalExtensionPaths: \[\s*bundledBrowserExtension,\s*bundledHarmonyExtension,\s*bundledGoalExtension,\s*bundledRoomExtension,\s*\]/,
  );
});

test("normal and device services cannot share a cwd cache entry", () => {
  assert.match(rpc, /const cwdKey = `\$\{runtimeProfile\}:\$\{normalizeRpcCwd\(cwd\)\}`/);
});

test("new, resume, GET, and event connections all resolve the cold-start profile", () => {
  assert.match(newRoute, /getAgentRuntimeProfile\(\)/);
  assert.match(newRoute, /runtimeProfile,/);
  assert.match(existingRoute, /resolveSessionAgentRuntimeProfile\(id, runtimeProfile\)/);
  assert.match(existingRoute, /startRpcSession\(id, filePath, cwd, \{ runtimeProfile \}\)/);
  assert.match(eventsRoute, /resolveSessionAgentRuntimeProfile\(id, runtimeProfile\)/);
  assert.match(eventsRoute, /startRpcSession\(id, filePath, cwd, \{ runtimeProfile \}\)/);
});

test("prompt lifecycle cleanup is tied to final prompt settlement, abort, fork, and destroy", () => {
  const startHandler = rpc.slice(rpc.indexOf("start(): void"), rpc.indexOf("setForceEmptySystemPrompt"));
  assert.doesNotMatch(startHandler, /finishPromptRun/);
  assert.match(rpc, /await finishPromptRun\(promptRun, "idle"\)/);
  assert.match(rpc, /await finishPromptRun\(promptRun, "error"\)/);
  assert.match(rpc, /await finishPromptRun\(promptRun, "abort"\)/);
  assert.match(rpc, /await finishPromptRun\(this\.activePromptRun, "fork"\)/);
  assert.match(rpc, /void finishPromptRun\(promptRun, "destroy"\)/);
  assert.match(rpc, /const ownsPromptRun = !streamingBehavior \|\| !this\.activePromptRun/);
});

test("fork binds its inherited profile before exposure and quarantines binding failures", () => {
  const forkHandler = rpc.slice(rpc.indexOf('case "fork"'), rpc.indexOf('case "navigate_tree"'));
  const bindIndex = forkHandler.indexOf("bindSessionAgentRuntimeProfile(newSessionId, this.runtimeProfile)");
  const cacheIndex = forkHandler.indexOf("cacheSessionPath(newSessionId, newSessionFile)");
  assert.ok(bindIndex >= 0 && bindIndex < cacheIndex);
  assert.match(forkHandler, /catch \(profileError\) \{\s*quarantineUnboundSessionFile\(newSessionFile\)/);
});

test("standalone staging includes the first-party device and target extensions", () => {
  assert.match(staging, /extensions\/piora-harmony\.ts/);
  assert.match(staging, /extensions\/piora-goal\.ts/);
});
