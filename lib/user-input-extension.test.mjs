import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { default: registerUserInput } = await jiti.import("../extensions/piora-user-input.ts");
const { writeRuntimePromptSettings } = await jiti.import("./prompt-runtime/settings.ts");

function harness(result) {
  let tool;
  let beforeStart;
  let request;
  registerUserInput({
    registerTool(candidate) { tool = candidate; },
    on(event, handler) { if (event === "before_agent_start") beforeStart = handler; },
  });
  const ctx = {
    ui: {
      async requestUserInput(title, description, questions, options) {
        request = { title, description, questions, options };
        return result;
      },
    },
  };
  return { get tool() { return tool; }, get request() { return request; }, get beforeStart() { return beforeStart; }, ctx };
}

const params = {
  title: "Choose a release",
  description: "The answer changes the next action.",
  questions: [{
    id: "channel",
    header: "Release channel",
    question: "Which channel should be used?",
    kind: "single_select",
    options: [{ label: "Stable", description: "Recommended" }, { label: "Preview" }],
  }],
};

test("tool waits for the native card and returns structured answers", async () => {
  const state = harness({ answers: { channel: ["Stable"] } });
  const result = await state.tool.execute("call", params, new AbortController().signal, undefined, state.ctx);
  assert.equal(state.tool.name, "piora_request_user_input");
  assert.equal(state.request.questions[0].header, "Release channel");
  assert.equal(state.request.options.timeout, 60_000);
  assert.deepEqual(result.details.answers, { channel: ["Stable"] });
  assert.match(result.content[0].text, /channel: Stable/);
});

test("timeout returns no answers or consent and guides the model to continue", async () => {
  const state = harness({ cancelled: true, reason: "timeout" });
  const result = await state.tool.execute("call", { ...params, timeoutSeconds: 120 }, undefined, undefined, state.ctx);
  assert.equal(state.request.options.timeout, 120_000);
  assert.deepEqual(result.details, { cancelled: true, reason: "timeout" });
  assert.match(result.content[0].text, /No answers or consent/);
  assert.match(result.content[0].text, /Continue work supported/);
  assert.match(result.content[0].text, /do not immediately ask the same questions/);
});

test("terminal fallback shares one deadline and never submits partial answers", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const state = harness(null);
  const timeouts = [];
  const result = await state.tool.execute("call", { ...params, questions: [...params.questions, { id: "notes", question: "Notes?", kind: "text", multiline: true }] }, undefined, undefined, {
    ui: {
      select: async (_title, _values, options) => { timeouts.push(options.timeout); t.mock.timers.tick(20_000); return "Stable"; },
      input: async (_title, _placeholder, options) => { timeouts.push(options.timeout); t.mock.timers.tick(options.timeout); return undefined; },
      editor: () => assert.fail("unbounded editor must not be used"),
    },
  });
  assert.deepEqual(timeouts, [60_000, 40_000]);
  assert.deepEqual(result.details, { cancelled: true, reason: "timeout" });
});

test("cancellation remains explicit and model capability respects runtime prompt toggle", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "piora-user-input-ext-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  const state = harness({ cancelled: true });
  const result = await state.tool.execute("call", params, new AbortController().signal, undefined, state.ctx);
  assert.equal(result.details.cancelled, true);
  assert.match(result.content[0].text, /Do not infer/);

  // Default OFF: suppresses prompt guidance and verbose toolGuidelines.
  const defaultEvent = {
    systemPrompt: "BASE",
    systemPromptOptions: {
      selectedTools: ["piora_request_user_input"],
      appendSystemPrompt: "",
      toolGuidelines: { piora_request_user_input: ["verbose"] },
    },
  };
  assert.equal(await state.beforeStart(defaultEvent), undefined);
  assert.equal(defaultEvent.systemPromptOptions.appendSystemPrompt, "");
  assert.deepEqual(defaultEvent.systemPromptOptions.toolGuidelines, {});

  // Enabled ON: injects concise non-conflicting guidance into <piora_runtime>.
  writeRuntimePromptSettings({ extensions: { userInput: true } }, dir);
  const enabledEvent = {
    systemPrompt: "BASE",
    systemPromptOptions: { selectedTools: ["piora_request_user_input"], appendSystemPrompt: "" },
  };
  assert.equal(await state.beforeStart(enabledEvent), undefined);
  assert.match(enabledEvent.systemPromptOptions.appendSystemPrompt, /<piora_runtime>/);
  assert.match(enabledEvent.systemPromptOptions.appendSystemPrompt, /- piora_request_user_input:/);
  assert.match(enabledEvent.systemPromptOptions.appendSystemPrompt, /otherwise state assumptions and proceed/);

  const unselected = { systemPrompt: "BASE", systemPromptOptions: { selectedTools: [], appendSystemPrompt: "" } };
  assert.equal(await state.beforeStart(unselected), undefined);
  assert.equal(unselected.systemPromptOptions.appendSystemPrompt, "");
});
