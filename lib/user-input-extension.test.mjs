import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { default: registerUserInput } = await jiti.import("../extensions/piora-user-input.ts");

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
      async requestUserInput(title, description, questions) {
        request = { title, description, questions };
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
  assert.deepEqual(result.details.answers, { channel: ["Stable"] });
  assert.match(result.content[0].text, /channel: Stable/);
});

test("cancellation remains explicit and model capability is injected only when active", async () => {
  const state = harness({ cancelled: true });
  const result = await state.tool.execute("call", params, new AbortController().signal, undefined, state.ctx);
  assert.equal(result.details.cancelled, true);
  assert.match(result.content[0].text, /Do not infer/);
  const active = await state.beforeStart({
    systemPrompt: "BASE",
    systemPromptOptions: { selectedTools: ["piora_request_user_input"] },
  });
  assert.match(active.systemPrompt, /piora_runtime_capability name="user_input_card" availability="active"/);
  assert.match(active.systemPrompt, /prefer this tool over an unstructured list of questions/);
  assert.equal(await state.beforeStart({ systemPrompt: "BASE", systemPromptOptions: { selectedTools: [] } }), undefined);
});
