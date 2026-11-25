import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { default: registerAutomations } = await jiti.import("../extensions/piora-automations.ts");
const { writeRuntimePromptSettings } = await jiti.import("./prompt-runtime/settings.ts");
const extensionSource = readFileSync(new URL("../extensions/piora-automations.ts", import.meta.url), "utf8");

test("scheduled tasks respect runtime prompt toggle, merge cleanly, and preserve tool descriptions", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "piora-automation-ext-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  const tools = [];
  const handlers = new Map();
  registerAutomations({
    registerTool: (tool) => tools.push(tool),
    on: (event, handler) => handlers.set(event, handler),
  });
  const beforeStart = handlers.get("before_agent_start");
  assert.ok(beforeStart);
  assert.ok(tools.some((tool) => tool.name === "piora_automation"));
  assert.match(extensionSource, /first choice for work that belongs in \$\{APP_DISPLAY_NAME\}/);
  assert.match(extensionSource, /Windows Task Scheduler/);
  assert.match(extensionSource, /schtasks/);

  // Default OFF: injects nothing and strips verbose toolGuidelines.
  const defaultEvent = {
    systemPrompt: "BASE",
    systemPromptOptions: {
      selectedTools: ["piora_automation"],
      appendSystemPrompt: "",
      toolGuidelines: { piora_automation: ["long rule"] },
    },
  };
  assert.equal(beforeStart(defaultEvent), undefined);
  assert.equal(defaultEvent.systemPromptOptions.appendSystemPrompt, "");
  assert.deepEqual(defaultEvent.systemPromptOptions.toolGuidelines, {});

  // Enabled ON: merges compact entry with targetScope=chat and system-scheduler allowance.
  writeRuntimePromptSettings({ extensions: { automations: true } }, dir);
  const enabledEvent = {
    systemPrompt: "BASE",
    systemPromptOptions: { selectedTools: ["piora_automation"], appendSystemPrompt: "" },
  };
  assert.equal(beforeStart(enabledEvent), undefined);
  const appended = enabledEvent.systemPromptOptions.appendSystemPrompt;
  assert.match(appended, /<piora_runtime>/);
  assert.match(appended, /- piora_automation:/);
  assert.match(appended, /targetScope=chat/);
  assert.match(appended, /System schedulers remain valid/);

  // Unselected: injects nothing even when enabled.
  const unselectedEvent = {
    systemPrompt: "BASE",
    systemPromptOptions: { selectedTools: [], appendSystemPrompt: "" },
  };
  assert.equal(beforeStart(unselectedEvent), undefined);
  assert.equal(unselectedEvent.systemPromptOptions.appendSystemPrompt, "");
});
