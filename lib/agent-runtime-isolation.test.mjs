import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const extensionConfig = await jiti.import("./extension-config.ts");

const [rpcBootstrap, rpcWrapper, rpcPrompt, rpcAbort, rpcSessionCommands] = await Promise.all([
  readFile(new URL("./rpc/session-bootstrap.ts", import.meta.url), "utf8"),
  readFile(new URL("./rpc/session-wrapper.ts", import.meta.url), "utf8"),
  readFile(new URL("./rpc/commands/prompt-command.ts", import.meta.url), "utf8"),
  readFile(new URL("./rpc/commands/abort-command.ts", import.meta.url), "utf8"),
  readFile(new URL("./rpc/commands/session-commands.ts", import.meta.url), "utf8"),
]);
const rpc = [rpcBootstrap, rpcWrapper, rpcPrompt, rpcAbort, rpcSessionCommands].join("\n");
const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");
const existingRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
const eventsRoute = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
const staging = await readFile(new URL("../scripts/stage-standalone.mjs", import.meta.url), "utf8");

test("device-control admits only its first-party extension allow-list", () => {
  assert.deepEqual(
    extensionConfig.firstPartyExtensionPaths("device-control").map((path) => basename(path)).sort(),
    ["piora-harmony.ts"],
  );
  assert.deepEqual(
    extensionConfig.enabledFirstPartyExtensionPaths("device-control", {
      version: 1,
      disabled: ["piora:computer"],
    }).map((path) => basename(path)),
    ["piora-harmony.ts"],
  );

  // Keep a small integration boundary check here: isolation also depends on
  // the SDK loader options, while extension membership is verified above.
  assert.match(rpc, /runtimeProfile === "device-control"/);
  assert.match(rpc, /toolsOption = toolNames \?\? \[\.\.\.DEVICE_CONTROL_AGENT_TOOLS\]/);
  assert.match(rpc, /additionalExtensionPaths: extensionPlan\.enabledPaths/);
  assert.match(rpc, /noExtensions: true/);
  assert.match(rpc, /noSkills: true/);
  assert.match(rpc, /noPromptTemplates: true/);
  assert.match(rpc, /noThemes: true/);
  assert.match(rpc, /noContextFiles: true/);
  assert.match(rpc, /systemPromptOverride: \(\) => undefined/);
  assert.match(rpc, /appendSystemPromptOverride: \(\) => \[\]/);
  assert.doesNotMatch(rpc, /loadedPaths\.length !== expectedPaths\.length/);
  assert.match(rpc, /DEVICE_CONTROL_DENIED_RPC_COMMANDS/);
  assert.match(rpc, /if \(runtimeProfile === "normal"\) ensureWindowsBashShellPath/);
});

test("ordinary sessions expose every first-party extension to the load plan", () => {
  assert.deepEqual(
    extensionConfig.firstPartyExtensionPaths("normal").map((path) => basename(path)).sort(),
    ["piora-automations.ts", "piora-browser.ts", "piora-computer.ts", "piora-file-changes.ts", "piora-harmony.ts", "piora-meme.ts", "piora-room.ts", "piora-shell-guard.ts", "piora-ssh.ts", "piora-subagent.ts", "piora-vision-agent.ts", "piora-workflows.ts"],
  );
});

test("normal and device services cannot share a cwd cache entry", () => {
  assert.match(rpc, /const sessionServicesKey = `\$\{runtimeProfile\}:\$\{sessionId\}`/);
  assert.match(rpc, /getServicesCache\(\)\.delete\(sessionServicesKey\)/);
});

test("new, resume, GET, and event connections all resolve the cold-start profile", () => {
  assert.match(newRoute, /getAgentRuntimeProfile\(\)/);
  assert.match(newRoute, /runtimeProfile,/);
  assert.match(existingRoute, /resolveOrStartRpcSession\(id, \{ runtimeProfile \}\)/);
  assert.match(eventsRoute, /resolveOrStartRpcSession\(id, \{ runtimeProfile \}\)/);
});

test("prompt lifecycle cleanup is tied to final prompt settlement, abort, fork, and destroy", () => {
  const startHandler = rpcWrapper.slice(rpcWrapper.indexOf("start(): void"), rpcWrapper.indexOf("setForceEmptySystemPrompt"));
  assert.doesNotMatch(startHandler, /finishPromptRun/);
  assert.match(rpcPrompt, /await finishPromptRun\(promptRun, "idle"\)/);
  assert.match(rpcPrompt, /await finishPromptRun\(promptRun, "error"\)/);
  assert.match(rpcAbort, /const cleanupTask = finishPromptRun\(promptRun, "abort"\)/);
  assert.match(rpcSessionCommands, /await finishPromptRun\(host\.activePromptRun, "fork"\)/);
  assert.match(rpcWrapper, /writers\.push\(finishPromptRun\(promptRun, "destroy"\)\)/);
  assert.match(rpcWrapper, /await Promise\.allSettled\(writers\)/);
  assert.match(rpcPrompt, /const ownsPromptRun = !streamingBehavior \|\| !host\.activePromptRun/);
});

test("fork binds its inherited profile before exposure and quarantines binding failures", () => {
  const forkHandler = rpcSessionCommands.slice(rpcSessionCommands.indexOf("export function handleForkCommand"), rpcSessionCommands.indexOf("export async function handleNavigateTreeCommand"));
  const bindIndex = forkHandler.indexOf("bindSessionAgentRuntimeProfile(newSessionId, host.runtimeProfile)");
  const cacheIndex = forkHandler.indexOf("cacheSessionPath(newSessionId, newSessionFile)");
  assert.ok(bindIndex >= 0 && bindIndex < cacheIndex);
  assert.match(forkHandler, /catch \(profileError\) \{\s*quarantineUnboundSessionFile\(newSessionFile\)/);
});

test("standalone staging includes device tools and excludes bundled goal and plan workflows", () => {
  assert.match(staging, /extensions\/piora-harmony\.ts/);
  assert.doesNotMatch(staging, /extensions\/piora-goal\.ts/);
  assert.doesNotMatch(staging, /extensions\/piora-plan\.ts/);
  assert.match(staging, /extensions\/piora-vision-agent\.ts/);
  assert.match(staging, /\["Piora runtime support modules", "lib"\]/);
});
