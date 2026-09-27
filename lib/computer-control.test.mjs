import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { ComputerControlRuntime, compactComputerContent } = await jiti.import("./computer-control.ts");
const { default: register } = await jiti.import("../extensions/piora-computer.ts");
const { estimateToolDefinitionPromptTokens } = await jiti.import("./tool-definition-budget.ts");

test("computer schemas use a single compact model entry", () => {
  const tools = []; register({ registerTool: (tool) => tools.push(tool) });
  assert.equal(tools.length, 1); assert.ok(estimateToolDefinitionPromptTokens(tools) < 600);
});

test("enabled computer tools enter new coding sessions and announce desktop access only while selected", async () => {
  const { buildSessionCapabilityCatalog, createSessionCapabilityPolicy } = await jiti.import("./session-capabilities.ts");
  const tools = []; let beforeStart;
  register({ registerTool: (tool) => tools.push(tool), on: (event, handler) => { if (event === "before_agent_start") beforeStart = handler; } });
  const catalog = buildSessionCapabilityCatalog(tools, "normal");
  assert.ok(createSessionCapabilityPolicy(undefined, catalog, "normal").enabledCapabilityIds.includes("tool:computer_control"));
  assert.deepEqual(createSessionCapabilityPolicy({ preset: "custom", enabledCapabilityIds: [] }, catalog, "normal").enabledCapabilityIds, []);
  assert.deepEqual(createSessionCapabilityPolicy(undefined, [], "normal").enabledCapabilityIds, []);
  const event = { systemPrompt: "CUSTOM", systemPromptOptions: { selectedTools: ["computer_control"] } };
  assert.match(beforeStart(event).systemPrompt, /Windows desktop observation and control are available/);
  assert.equal(beforeStart({ ...event, systemPromptOptions: { selectedTools: [] } }), undefined);
});
test("desktop output is bounded and cannot forward arbitrary MCP resource blocks", () => {
  const content = compactComputerContent([{ type: "text", text: "x".repeat(20000) }, { type: "resource", resource: { uri: "file:///private" } }, { type: "image", data: "abc", mimeType: "image/png" }, { type: "image", data: "def", mimeType: "image/png" }]);
  assert.equal(content.length, 2); assert.ok(content[0].text.length < 12100);
});
test("one owner controls the desktop; emergency stop persists until manually resumed", async () => {
  const runtime = new ComputerControlRuntime();
  runtime.claim("one"); assert.throws(() => runtime.claim("two"), /Another task/);
  await runtime.release("two"); assert.throws(() => runtime.claim("two"), /Another task/);
  await runtime.stop(); assert.equal(runtime.state().stopped, true);
  await assert.rejects(() => runtime.connect(), /stopped/);
  runtime.resume(); assert.equal(runtime.state().stopped, false);
});

test("desktop calls forward exact operation arguments and propagate backend failure", async (context) => {
  const runtime = new ComputerControlRuntime();
  const connect = context.mock.method(runtime, "connect", async () => {});
  const calls = [];
  runtime.client = { callTool: async (input) => { calls.push(input); return { isError: true, content: [{ type: "text", text: "target missing" }] }; } };
  runtime.tools = [{ name: "Click", inputSchema: { type: "object" } }];
  runtime.claim("one");
  runtime.uiaObserved = true; runtime.visualObserved = true;
  const result = await runtime.call("one", "Click", { loc: [10, 20] });
  assert.equal(connect.mock.callCount(), 1);
  assert.deepEqual(calls, [{ name: "Click", arguments: { loc: [10, 20] } }]);
  assert.equal(result.isError, true);
  await runtime.release("one");
});

test("failed desktop actions disconnect and are never automatically replayed", async (context) => {
  const runtime = new ComputerControlRuntime(); let calls = 0;
  const connect = context.mock.method(runtime, "connect", async () => {});
  runtime.client = { callTool: async () => { calls++; throw new Error("timeout"); } };
  runtime.tools = [{ name: "Click", inputSchema: { type: "object" } }];
  runtime.claim("one");
  runtime.uiaObserved = true; runtime.visualObserved = true;
  await assert.rejects(() => runtime.call("one", "Click", {}), /timeout/);
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(calls, 1); assert.equal(runtime.state().connected, false);
  runtime.claim("two");
});

test("coordinate actions require UIA inspection and a fresh visual observation", async (context) => {
  const runtime = new ComputerControlRuntime(); let calls = 0;
  context.mock.method(runtime, "connect", async () => {});
  runtime.client = { callTool: async () => { calls++; return { content: [] }; } };
  runtime.tools = [{ name: "Click", inputSchema: { type: "object" } }];
  await assert.rejects(() => runtime.call("one", "Click", { loc: [10, 20] }), /Inspect UIA controls/);
  assert.equal(calls, 0);
});

test("UIA mutations require a current observation of the same window", async (context) => {
  const runtime = new ComputerControlRuntime(); const calls = [];
  context.mock.method(runtime, "connect", async () => {});
  runtime.uia.call = async (name, input) => { calls.push({ name, input }); return { content: [{ type: "text", text: "{}" }], isError: false }; };
  await assert.rejects(() => runtime.call("one", "uia_invoke", { hwnd: 10, selector: "btn-save-abcd", action: "invoke" }), /Inspect or find/);
  await runtime.call("one", "uia_inspect", { hwnd: "0xa" });
  await runtime.call("one", "uia_invoke", { hwnd: 10, selector: "btn-save-abcd", action: "invoke" });
  await assert.rejects(() => runtime.call("one", "uia_set_value", { hwnd: 11, selector: "txt-name-abcd", value: "hello" }), /Inspect or find/);
  assert.deepEqual(calls.map(({ name }) => name), ["uia_inspect", "uia_invoke"]);
});

test("screenshot fallback requires target UIA inspection and display inventory", async (context) => {
  const runtime = new ComputerControlRuntime(); const calls = [];
  context.mock.method(runtime, "connect", async () => {});
  runtime.uia.call = async () => ({ content: [{ type: "text", text: "{}" }], isError: false });
  const client = { callTool: async ({ name }) => { calls.push(name); return { content: name === "Screenshot" ? [{ type: "image", data: "abc", mimeType: "image/png" }] : [] }; } };
  const tools = ["DisplayInventory", "Screenshot"].map((name) => ({ name, inputSchema: { type: "object" } }));
  runtime.client = client; runtime.tools = tools;
  await runtime.call("one", "uia_inspect", { hwnd: 10 });
  await assert.rejects(() => runtime.call("one", "Screenshot", {}), /DisplayInventory/);
  runtime.client = client; runtime.tools = tools;
  await runtime.call("one", "uia_inspect", { hwnd: 10 });
  await runtime.call("one", "DisplayInventory", {});
  const screenshot = await runtime.call("one", "Screenshot", {});
  assert.equal(screenshot.content[0].type, "image");
  assert.deepEqual(calls, ["DisplayInventory", "Screenshot"]);
});

test("desktop connection enforces host support before opening the backend", async (context) => {
  const runtime = new ComputerControlRuntime();
  const open = context.mock.method(runtime, "open", async () => {});
  if (process.platform === "win32") {
    await runtime.connect();
    assert.equal(open.mock.callCount(), 1);
  } else {
    await assert.rejects(() => runtime.connect(), /Windows only/);
    assert.equal(open.mock.callCount(), 0);
  }
});
