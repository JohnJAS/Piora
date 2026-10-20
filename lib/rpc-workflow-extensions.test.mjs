import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { createSdkTestFixture } from "./pi-sdk-test-fixture.mjs";

const jiti = createJiti(import.meta.url);
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const sdkRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const planExtension = await jiti.import(join(sdkRoot, "examples/extensions/plan-mode/index.ts"), { default: true });

async function waitFor(predicate, description) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("the SDK plan extension switches tools, asks for execution and runs the accepted plan", { timeout: 20000 }, async context => {
  const fixture = await createSdkTestFixture(context, {
    extension: planExtension,
    toolNames: ["read", "bash", "edit", "write"],
    step: request => [{ type: "text", text: request.index === 0 ? "Plan:\n1. Inspect the workspace\n2. Finish the task" : "[DONE:1] [DONE:2] Completed" }],
  });
  const session = await fixture.create();
  const wrapper = new AgentSessionWrapper(session);
  context.after(() => wrapper.destroy());
  wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  const events = [];
  wrapper.onEvent(event => events.push(event));
  await wrapper.executeChatCommand("toggle-plan", "/plan");
  assert.equal(session.getActiveToolNames().includes("write"), false);
  assert.ok(events.some(event => event.method === "setStatus" && event.statusText?.includes("plan")));
  await wrapper.send({ type: "prompt", message: "Plan this task" });
  await waitFor(() => events.some(event => event.method === "select"), "plan execution choice");
  const choice = events.find(event => event.method === "select");
  await wrapper.send({ type: "extension_ui_response", id: choice.id, value: choice.options[0] });
  await waitFor(() => events.some(event => event.type === "prompt_done"), "plan completion");
  assert.ok(fixture.requests.length >= 2 && fixture.requests.length <= 3);
  assert.ok(session.getActiveToolNames().includes("write"));
  assert.match(JSON.stringify(fixture.requests[0].messages), /PLAN MODE ACTIVE/);
  assert.match(JSON.stringify(fixture.requests.at(-1).messages), /Execute the plan/);
  assert.equal(events.filter(event => event.type === "prompt_done").length, 1);
  assert.equal(events.some(event => event.type === "extension_error"), false);
});

test("installed workflow helpers survive initialization and errors do not report success", { timeout: 20000 }, async context => {
  let wrapper;
  context.after(async () => { wrapper?.destroy(); await wrapper?.shutdownForFileMutation(); });
  const fixture = await createSdkTestFixture(context, {
    toolNames: null,
    extension: pi => {
      pi.registerTool({ name: "workflow_complete", description: "Finish a workflow", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "Done" }] }) });
      pi.registerTool({ name: "opt_in_helper", defaultActive: false, description: "Only when selected", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }) });
      pi.registerCommand("workflow", { handler: async (_args, ctx) => {
        if (!pi.getActiveTools().includes("workflow_complete")) { ctx.ui.notify("Required workflow tool is unavailable", "error"); return; }
        ctx.ui.notify("Workflow started", "info");
        pi.sendUserMessage("Perform the workflow");
      } });
    },
  });
  const session = await fixture.create();
  wrapper = new AgentSessionWrapper(session);
  wrapper.initializeSessionCapabilities(); wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  assert.ok(session.getActiveToolNames().includes("workflow_complete"));
  assert.equal(session.getActiveToolNames().includes("opt_in_helper"), false);
  const { executeChatCommandOperation } = await jiti.import("./chat-command-runtime.ts");
  const result = await executeChatCommandOperation({ commandId: "workflow-command", operation: { command: { source: "extension", name: "workflow" }, arguments: "" } }, { session: wrapper, assertActive() {}, phase() {} });
  assert.deepEqual(result.details, ["Workflow started"]);
  assert.equal(fixture.requests.length, 1);
  await wrapper.send({ type: "set_tools", toolNames: ["read"] });
  await assert.rejects(wrapper.executeChatCommand("workflow-denied", "/workflow"), /Required workflow tool is unavailable/);
  assert.equal(fixture.requests.length, 1);
});

test("extension goal continuations keep the run active until all queued turns finish", { timeout: 20000 }, async context => {
  const fixture = await createSdkTestFixture(context, {
    extension: pi => {
      let remaining = 0;
      pi.registerCommand("goal", { handler: async args => { remaining = 2; pi.sendUserMessage(args); } });
      pi.on("agent_end", () => {
        if (remaining-- > 0) pi.sendUserMessage("Continue the goal", { deliverAs: "followUp" });
      });
    },
  });
  const session = await fixture.create();
  const wrapper = new AgentSessionWrapper(session);
  context.after(() => wrapper.destroy());
  wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  const events = [];
  wrapper.onEvent(event => events.push(event));
  await wrapper.executeChatCommand("goal-command", "/goal Complete the task");
  assert.equal(fixture.requests.length, 3);
  assert.equal(events.filter(event => event.type === "prompt_done").length, 1);
  assert.equal(events.some(event => event.type === "extension_error"), false);
});
