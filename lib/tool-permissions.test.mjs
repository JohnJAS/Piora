import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { Type } from "@earendil-works/pi-ai";
import { createSdkTestFixture } from "./pi-sdk-test-fixture.mjs";

const jiti = createJiti(import.meta.url);
const { needsToolApproval } = await jiti.import("./tool-permission-policy.ts");
const { authorizeTool } = await jiti.import("./tool-permission-gate.ts");
const store = await jiti.import("./tool-permission-store.ts");
const { hasFullToolAccess } = await jiti.import("../desktop/src/tool-permission.ts");
const bridge = await jiti.import("./desktop-browser-agent.ts");

test("known operations and opaque tools follow all three policies", () => {
  for (const mode of ["ask", "auto", "full"]) {
    const state = { mode, revision: 1 };
    for (const tool of ["read", "grep", "find", "ls", "piora_request_user_input"]) assert.equal(needsToolApproval(state, tool, {}), false);
    assert.equal(needsToolApproval(state, "write", {}), mode === "ask");
    for (const tool of ["bash", "powershell", "plugin_send", "unknown_read"]) assert.equal(needsToolApproval(state, tool, { command: "echo harmless" }), mode !== "full");
    assert.equal(needsToolApproval(state, "browser", { action: "snapshot" }), false);
    assert.equal(needsToolApproval(state, "browser", { action: "open" }), mode === "ask");
    for (const action of ["evaluate", "click", "type", "press"]) assert.equal(needsToolApproval(state, "browser", { action }), mode !== "full");
  }
  assert.equal(needsToolApproval({ mode: "full", revision: 0, legacy: true }, "bash", {}), false);
});

test("policy persists independently per chat and desktop reads only explicit full grants", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-permissions-"));
  try {
    assert.deepEqual(store.readToolPermission("old", root), { mode: "full", revision: 0, legacy: true });
    assert.equal(store.readDefaultToolPermission(root), "auto");
    store.writeDefaultToolPermission("ask", root);
    assert.equal(store.readDefaultToolPermission(root), "ask");
    assert.equal(hasFullToolAccess(root, "old"), false);
    store.writeToolPermission("chat-a", "full", root);
    assert.equal(hasFullToolAccess(root, "chat-a"), true);
    assert.equal(hasFullToolAccess(root, "chat-b"), false);
    assert.equal(store.readToolPermission("chat-a", root).mode, "full");
    assert.equal(store.writeToolPermission("chat-a", "ask", root).revision, 2);
    assert.equal(hasFullToolAccess(root, "chat-a"), false);
    assert.throws(() => store.writeToolPermission("../escape", "full", root));
    writeFileSync(join(root, "piora", "tool-permissions", "chat-a.json"), "{");
    assert.throws(() => store.readToolPermission("chat-a", root));
    assert.equal(hasFullToolAccess(root, "chat-a"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("stale approvals cannot grant full access after a policy change, cancellation never grants", async () => {
  let state = { mode: "auto", revision: 1 }, calls = 0, grants = 0;
  const base = { name: "bash", args: {}, read: () => state, active: () => true, grantFull: () => { grants++; } };
  assert.equal(await authorizeTool({ ...base, ask: async () => {
    calls++;
    if (calls === 1) { state = { mode: "ask", revision: 2 }; return "full"; }
    return "deny";
  } }), false);
  assert.equal(calls, 2); assert.equal(grants, 0);
  let active = true;
  assert.equal(await authorizeTool({ ...base, active: () => active, ask: async () => { active = false; return "full"; } }), false);
  assert.equal(grants, 0);
  state = { mode: "full", revision: 3 };
  assert.equal(await authorizeTool({ ...base, ask: async () => { throw new Error("must not ask"); } }), true);
});

test("unified browser authorization removes duplicate dialogs but retains navigation checks", async () => {
  const check = { allowed: true, url: "https://example.test", navigationToken: "page-1" };
  const confirm = () => { throw new Error("duplicate confirmation"); };
  assert.equal((await bridge.gateDesktopEvaluate({ check, authorized: true, hasUI: false, confirm })).confirmed, true);
  assert.ok("error" in await bridge.gateDesktopEvaluate({ check: { ...check, navigationToken: "" }, authorized: true, hasUI: true, confirm }));
});

test("real SDK gates nested tools, survives reload, and full access never answers ordinary questions", { timeout: 30000 }, async t => {
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  let outerCalls = 0, innerCalls = 0, questions = 0, phase = "deny-nested";
  const f = await createSdkTestFixture(t, { toolNames: ["outer", "inner"],
    step: request => request.index % 2 === 0 ? [{ type: "toolCall", id: `call-${request.index}`, name: "outer", arguments: {} }] : [{ type: "text", text: "done" }],
    extension: pi => {
      pi.registerTool({ name: "inner", label: "inner", description: "test", parameters: Type.Object({}), async execute() {
        innerCalls++; return { content: [{ type: "text", text: "inner ran" }] };
      } });
      pi.registerTool({ name: "outer", label: "outer", description: "test", parameters: Type.Object({}), async execute(_id, _args, _signal, _update, ctx) {
        outerCalls++;
        const result = await ctx.executeTool("inner", {});
        if (phase === "full") await ctx.ui.confirm("Ordinary question", "Choose a business option");
        return { content: result.content };
      } });
    },
  });
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = f.agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const session = await f.create();
  const wrapper = new AgentSessionWrapper(session);
  wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  t.after(() => wrapper.destroy());
  await wrapper.send({ type: "set_tool_permission", mode: "ask" });
  const approvals = [];
  const held = [];
  wrapper.onEvent(event => {
    if (event.type !== "extension_ui_request" || event.method !== "confirm") return;
    if (phase === "hold") { held.push(event); return; }
    if (event.toolApproval) approvals.push(event.title);
    else questions++;
    void wrapper.send({ type: "extension_ui_response", id: event.id, confirmed: !event.toolApproval || event.title === "outer" });
  });
  await session.prompt("test permissions");
  assert.deepEqual(approvals, ["outer", "inner"]);
  assert.equal(outerCalls, 1); assert.equal(innerCalls, 0);
  await wrapper.send({ type: "reload" });
  await session.prompt("after reload");
  assert.deepEqual(approvals, ["outer", "inner", "outer", "inner"]);
  phase = "full";
  await wrapper.send({ type: "set_tool_permission", mode: "full" });
  await session.prompt("full access");
  assert.equal(approvals.length, 4);
  assert.equal(innerCalls, 1); assert.equal(questions, 1);
  phase = "hold";
  await wrapper.send({ type: "set_tool_permission", mode: "ask" });
  const first = session.extensionRunner.emitToolCall({ type: "tool_call", toolName: "inner", toolCallId: "pending-a", input: {} });
  const second = session.extensionRunner.emitToolCall({ type: "tool_call", toolName: "inner", toolCallId: "pending-b", input: {} });
  let ordinarySettled = false;
  const ordinary = wrapper.createExtensionUiContext().confirm("Business question", "Choose").then(() => { ordinarySettled = true; });
  for (let i = 0; held.length < 3 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(held.length, 3);
  await wrapper.send({ type: "set_tool_permission", mode: "full" });
  assert.equal(await first, undefined); assert.equal(await second, undefined);
  assert.equal(ordinarySettled, false);
  const question = held.find(event => !event.toolApproval);
  await wrapper.send({ type: "extension_ui_response", id: question.id, cancelled: true });
  await ordinary;
  await wrapper.send({ type: "set_tool_permission", mode: "ask" });
  const blocked = session.extensionRunner.emitToolCall({ type: "tool_call", toolName: "inner", toolCallId: "pending-abort", input: {} });
  for (let i = 0; held.length < 4 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  await wrapper.send({ type: "abort" });
  assert.equal((await blocked).block, true);
  assert.equal(store.readToolPermission(session.sessionId, f.agentDir).mode, "ask");

});
