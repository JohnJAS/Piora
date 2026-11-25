import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { default: registerBrowser } = await jiti.import("../extensions/piora-browser.ts");
const { default: registerHarmony } = await jiti.import("../extensions/piora-harmony.ts");
const { writeRuntimePromptSettings } = await jiti.import("./prompt-runtime/settings.ts");

function withTempAgentDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "piora-capability-discovery-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function captureBeforeAgentStart(register) {
  let handler;
  const tools = [];
  register({
    registerTool(candidate) { tools.push(candidate); },
    on(event, candidate) {
      if (event === "before_agent_start") handler = candidate;
    },
  });
  assert.ok(tools.length);
  assert.ok(handler);
  return { handler, tool: tools.at(-1), tools };
}

function event(selectedTools, appendSystemPrompt = "", toolGuidelines = {}) {
  return {
    type: "before_agent_start",
    prompt: "test",
    systemPrompt: "CUSTOM SYSTEM PROMPT",
    systemPromptOptions: { selectedTools, appendSystemPrompt, toolGuidelines },
  };
}

test("browser and Harmony capabilities merge into one <piora_runtime> block without aggressive phrasing", async (t) => {
  const agentDir = withTempAgentDir(t);
  const previousWorkbench = process.env.PIORA_HARMONY_WORKBENCH;
  process.env.PIORA_HARMONY_WORKBENCH = "1";
  t.after(() => {
    if (previousWorkbench === undefined) delete process.env.PIORA_HARMONY_WORKBENCH;
    else process.env.PIORA_HARMONY_WORKBENCH = previousWorkbench;
  });

  const { handler: browserHandler, tool: browserTool } = captureBeforeAgentStart(registerBrowser);
  const { handler: harmonyHandler, tools: harmonyTools } = captureBeforeAgentStart(registerHarmony);
  assert.equal(browserTool.name, "browser");
  assert.equal(harmonyTools[0].name, "harmony_control");

  // Default: browser=true, harmony=false
  const activeEvent = event(["browser", "harmony_list_devices", "harmony_tap"], "", {
    browser: ["verbose"],
    harmony_control: ["verbose"],
  });
  assert.equal(await browserHandler(activeEvent, {}), undefined);
  assert.equal(await harmonyHandler(activeEvent, {}), undefined);
  assert.match(activeEvent.systemPromptOptions.appendSystemPrompt, /<piora_runtime>/);
  assert.match(activeEvent.systemPromptOptions.appendSystemPrompt, /- browser:/);
  assert.doesNotMatch(activeEvent.systemPromptOptions.appendSystemPrompt, /harmony_control/);
  assert.doesNotMatch(activeEvent.systemPromptOptions.appendSystemPrompt, /Never claim/i);
  assert.deepEqual(activeEvent.systemPromptOptions.toolGuidelines, {});

  // Enable harmony: both merge into the same <piora_runtime> block and deduplicate.
  writeRuntimePromptSettings({ extensions: { harmony: true } }, agentDir);
  assert.equal(await browserHandler(activeEvent, {}), undefined);
  assert.equal(await harmonyHandler(activeEvent, {}), undefined);
  const merged = activeEvent.systemPromptOptions.appendSystemPrompt;
  assert.equal(merged.match(/<piora_runtime>/g)?.length, 1);
  assert.match(merged, /- browser:/);
  assert.match(merged, /- harmony_control:/);

  // Unselected tools inject nothing.
  const emptyEvent = event([]);
  assert.equal(await browserHandler(emptyEvent, {}), undefined);
  assert.equal(await harmonyHandler(emptyEvent, {}), undefined);
  assert.equal(emptyEvent.systemPromptOptions.appendSystemPrompt, "");

  // Disabled browser injects nothing.
  writeRuntimePromptSettings({ extensions: { browser: false, harmony: false } }, agentDir);
  const disabledEvent = event(["browser", "harmony_list_devices"]);
  assert.equal(await browserHandler(disabledEvent, {}), undefined);
  assert.equal(await harmonyHandler(disabledEvent, {}), undefined);
  assert.equal(disabledEvent.systemPromptOptions.appendSystemPrompt, "");
});
