import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { default: registerBrowser } = await jiti.import("../extensions/piora-browser.ts");
const { default: registerHarmony } = await jiti.import("../extensions/piora-harmony.ts");

function captureBeforeAgentStart(register) {
  let handler;
  let tool;
  register({
    registerTool(candidate) { tool = candidate; },
    on(event, candidate) {
      if (event === "before_agent_start") handler = candidate;
    },
  });
  assert.ok(tool);
  assert.ok(handler);
  return { handler, tool };
}

function event(systemPrompt, selectedTools) {
  return {
    type: "before_agent_start",
    prompt: "test",
    systemPrompt,
    systemPromptOptions: { selectedTools },
  };
}

test("browser capability is appended to custom system prompts only while its tool is active", async () => {
  const { handler, tool } = captureBeforeAgentStart(registerBrowser);
  assert.equal(tool.name, "browser");

  const active = await handler(event("CUSTOM SYSTEM PROMPT", ["browser"]), {});
  assert.match(active.systemPrompt, /^CUSTOM SYSTEM PROMPT/);
  assert.match(active.systemPrompt, /piora_runtime_capability name="browser" availability="active"/);
  assert.match(active.systemPrompt, /Never claim browsing is unavailable/);
  assert.equal(await handler(event("CUSTOM SYSTEM PROMPT", []), {}), undefined);
  assert.equal(await handler(event(active.systemPrompt, ["browser"]), {}), undefined);
});

test("Harmony capability is appended to custom system prompts only while its tool is active", async () => {
  const { handler, tool } = captureBeforeAgentStart(registerHarmony);
  assert.equal(tool.name, "harmony_device");

  const active = await handler(event("CUSTOM SYSTEM PROMPT", ["harmony_device"]), {});
  assert.match(active.systemPrompt, /^CUSTOM SYSTEM PROMPT/);
  assert.match(active.systemPrompt, /piora_runtime_capability name="harmony_device" availability="active"/);
  assert.match(active.systemPrompt, /harmony_device\(\{ action: "list_devices" \}\)/);
  assert.equal(await handler(event("CUSTOM SYSTEM PROMPT", []), {}), undefined);
  assert.equal(await handler(event(active.systemPrompt, ["harmony_device"]), {}), undefined);
});
