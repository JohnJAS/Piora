import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { Type } from "typebox";
import { createSdkTestFixture } from "./pi-sdk-test-fixture.mjs";
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(import.meta.dirname, "..") } });
const { SubagentRuntime, bindSubagentRuntime } = await jiti.import("./subagent-runtime.ts");
const { DEFAULT_SUBAGENT_SETTINGS, readSubagentSettings, writeSubagentSettings, parseSubagentSettings, listSubagentProfiles } = await jiti.import("./subagent-settings.ts");
const { childToolNames } = await jiti.import("./subagent-driver.ts");
const { saveSubagent } = await jiti.import("./subagent-store.ts");
const { GET, PUT } = await jiti.import("../app/api/settings/subagents/route.ts");

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "piora-subagent-")), previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  t.after(async () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
  const settings = { ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true };
  return { dir, settings };
}
const input = prompt => ({ description: prompt, prompt });
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const aborted = signal => new Promise((_, reject) => { signal.throwIfAborted(); signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
const put = body => PUT(new Request("http://localhost/api/settings/subagents", { method: "PUT", body: JSON.stringify(body) }));

test("the SDK model sees delegation tools only while the durable switch is enabled", { timeout: 30000 }, async t => {
  const subagentExtension = (await jiti.import("../extensions/piora-subagent.ts")).default;
  const f = await createSdkTestFixture(t, { toolNames: null, extension: subagentExtension });
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = f.agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const wrapper = new AgentSessionWrapper(await f.create());
  t.after(() => wrapper.destroy()); wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady(); wrapper.initializeSessionCapabilities();
  const prompt = async text => {
    const done = new Promise(resolve => { const detach = wrapper.onEvent(event => { if (event.type === 'prompt_done') { detach(); resolve(); } }); });
    await wrapper.send({ type: 'prompt', message: text }); await done;
    return f.requests.at(-1).tools.map(tool => tool.name);
  };
  assert.ok(!(await prompt('Feature is off')).includes('Agent'));
  writeSubagentSettings({ ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true });
  const enabledTools = await prompt('Feature is on');
  assert.ok(enabledTools.includes('Agent'), JSON.stringify({ enabledTools, all: wrapper.inner.getAllTools().map(tool => ({ name: tool.name, exposure: tool.exposure })) }));
  writeSubagentSettings({ ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: false });
  assert.ok(!(await prompt('Feature disabled again')).includes('Agent'));
});

test("SDK child tools use the parent's live approvals and ceiling, and route ordinary questions to its UI", { timeout: 30000 }, async t => {
  let phase = "effect", effects = 0, outside = 0, questions = 0;
  const f = await createSdkTestFixture(t, { toolNames: ["effect", "outside"],
    step: request => request.index % 2 === 0 ? [{ type: "toolCall", id: `child-${request.index}`, name: phase, arguments: {} }] : [{ type: "text", text: "done" }],
    extension: pi => {
      pi.registerTool({ name: "effect", label: "effect", description: "test mutation", parameters: Type.Object({}), async execute(_id, _args, _signal, _update, ctx) {
        effects++; await ctx.ui.confirm("Ordinary child question", "Choose an option"); return { content: [{ type: "text", text: "executed" }] };
      } });
      pi.registerTool({ name: "outside", label: "outside", description: "outside parent ceiling", parameters: Type.Object({}), async execute() {
        outside++; return { content: [{ type: "text", text: "must not run" }] };
      } });
    },
  });
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = f.agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
  const parent = new AgentSessionWrapper(await f.create(), "normal", { toolNameCeiling: ["effect"] });
  const child = new AgentSessionWrapper(await f.create(), "normal", { subagentParent: parent, toolNameCeiling: ["effect", "outside"] });
  t.after(() => { child.destroy(); parent.destroy(); });
  for (const wrapper of [parent, child]) { wrapper.start(); wrapper.beginExtensionBinding(); await wrapper.waitUntilReady(); }
  await parent.send({ type: "set_tool_permission", mode: "ask" });
  await child.send({ type: "set_tool_permission", mode: "full" });
  const approvals = [];
  parent.onEvent(event => {
    if (event.type !== "extension_ui_request" || event.method !== "confirm") return;
    if (event.toolApproval) approvals.push(event.title); else questions++;
    void parent.send({ type: "extension_ui_response", id: event.id, confirmed: !event.toolApproval });
  });
  child.onEvent(event => { assert.notEqual(event.type, "extension_ui_request", "child UI must be visible in its parent"); });
  await child.inner.prompt("Delegated task; this is not user authorization");
  assert.deepEqual(approvals, ["effect"]); assert.equal(effects, 0);
  phase = "outside";
  await child.inner.prompt("Try a tool outside the parent's ceiling");
  assert.equal(outside, 0); assert.deepEqual(approvals, ["effect"]);
  phase = "effect";
  await parent.send({ type: "set_tool_permission", mode: "full" });
  await child.inner.prompt("Parent changed its permission live");
  assert.equal(effects, 1); assert.equal(questions, 1); assert.deepEqual(approvals, ["effect"]);
});

test("subagents require an explicit durable opt-in and reject malformed settings", async t => {
  await fixture(t);
  assert.equal(readSubagentSettings().enabled, false);
  assert.equal((await (await GET()).json()).settings.enabled, false);
  const value = { ...structuredClone(DEFAULT_SUBAGENT_SETTINGS), enabled: true };
  assert.equal((await put(value)).status, 200);
  assert.deepEqual(readSubagentSettings(), value);
  for (const change of [{ enabled: "true" }, { maxConcurrency: 0 }, { timeoutSeconds: Infinity }, { maxTokens: 1.5 }, { modelOverrides: { Explore: "missing-provider" } }, { unknown: true }, { disabledProfiles: [1] }]) {
    assert.throws(() => parseSubagentSettings({ ...value, ...change }));
    assert.equal((await put({ ...value, ...change })).status, 400);
    assert.deepEqual(readSubagentSettings(), value);
  }
});

test("custom profiles use project precedence and cannot impersonate built-ins", async t => {
  const { dir } = await fixture(t), global = join(process.env.PI_CODING_AGENT_DIR, "agents"), project = join(dir, ".piora", "agents");
  await mkdir(global, { recursive: true }); await mkdir(project, { recursive: true });
  await writeFile(join(global, "review.md"), '---\nname: review\ndescription: Global review\n---\nGlobal instructions');
  await writeFile(join(project, "review.md"), '---\nname: review\ndescription: Local review\ntools: [read, grep]\nmodel: provider/model\nmaxTurns: 3\n---\nLocal instructions');
  const profile = listSubagentProfiles(dir).find(item => item.name === "review");
  assert.equal(profile.source, "project"); assert.equal(profile.systemPrompt.trim(), "Local instructions"); assert.deepEqual(profile.tools, ["read", "grep"]); assert.equal(profile.maxTurns, 3);
  await writeFile(join(project, "reserved.md"), '---\nname: Explore\n---\nOverride');
  assert.throws(() => listSubagentProfiles(dir), /reserved/);
});

test("child tools are an intersection, with no recursive delegation or room/task escape", () => {
  const parent = ["read", "grep", "write", "powershell", "Agent", "SendMessage", "TaskStop", "piora_room", "piora_automation", "piora_update_goal"];
  assert.deepEqual(childToolNames(parent, { tools: ["read", "grep", "ls", "Agent"] }), ["read", "grep"]);
  assert.deepEqual(childToolNames(parent, { disallowedTools: ["write", "powershell"] }), ["read", "grep"]);
});

test("foreground receives only supplied task, returns bounded findings and persists usage", async t => {
  const { dir, settings } = await fixture(t); settings.maxResultChars = 80;
  let received;
  const runtime = new SubagentRuntime("parent", dir, { async run(record, profile, signal, progress) { received = { prompt: record.prompt, profile: profile.name }; progress(45, 2); return "x".repeat(1000); }, async notify() { assert.fail("Foreground must not notify"); } }, () => settings);
  const result = await runtime.launch(input("Only this task"), "call");
  assert.deepEqual(received, { prompt: "Only this task", profile: "general-purpose" });
  assert.equal(result.status, "completed"); assert.equal(result.result.length, 80); assert.equal(result.totalTokens, 45); assert.equal(result.totalToolUseCount, 2);
  assert.equal(new SubagentRuntime("parent", dir, {}, () => settings).get(result.agentId).status, "completed");
});

test("independent calls run truly concurrently up to the ceiling and release slots", async t => {
  const { dir, settings } = await fixture(t); settings.maxConcurrency = 2;
  const started = deferred(), finish = deferred(); let concurrent = 0, peak = 0;
  const runtime = new SubagentRuntime("parent", dir, { async run(_record, _profile, signal) { concurrent++; peak = Math.max(peak, concurrent); if (concurrent === 2) started.resolve(); await Promise.race([finish.promise, aborted(signal)]); concurrent--; return "done"; }, async notify() {} }, () => settings);
  const first = runtime.launch(input("a"), "a"), second = runtime.launch(input("b"), "b"); await started.promise;
  await assert.rejects(runtime.launch(input("c"), "c"), /concurrency/); finish.resolve();
  assert.equal((await first).status, "completed"); assert.equal((await second).status, "completed"); assert.equal(peak, 2);
  assert.equal((await runtime.launch(input("c"), "c")).status, "completed");
});

test("background returns immediately, isolates the caller wait, and emits one durable completion", async t => {
  const { dir, settings } = await fixture(t), finish = deferred(), notified = deferred(); let notifications = 0;
  const runtime = new SubagentRuntime("parent", dir, { async run() { await finish.promise; return "BACKGROUND_DONE"; }, async notify(record) { notifications++; assert.equal(runtime.get(record.agentId).status, "completed"); notified.resolve(); } }, () => settings);
  const controller = new AbortController();
  const launched = await runtime.launch({ ...input("background"), run_in_background: true }, "call", controller.signal);
  assert.equal(launched.status, "running"); controller.abort(); finish.resolve(); await notified.promise;
  assert.equal((await runtime.output(launched.agentId, true)).result, "BACKGROUND_DONE"); assert.equal(notifications, 1);
});

test("parent stop cancels foreground and background children and drains their work", async t => {
  const { dir, settings } = await fixture(t), started = deferred(); let count = 0, cancelled = 0;
  const runtime = new SubagentRuntime("parent", dir, { async run(_r, _p, signal) { if (++count === 2) started.resolve(); try { return await aborted(signal); } finally { cancelled++; } }, async notify() { assert.fail("Cancelled tasks cannot notify"); } }, () => settings);
  const foreground = runtime.launch(input("foreground"), "one");
  const background = await runtime.launch({ ...input("background"), run_in_background: true }, "two");
  await started.promise; await runtime.stopAll();
  assert.equal((await foreground).status, "cancelled"); assert.equal(runtime.get(background.agentId).status, "cancelled"); assert.equal(cancelled, 2); assert.equal(runtime.running, false);
});

test("foreground AbortSignal cancels only that child; timeout is a failure", async t => {
  const { dir, settings } = await fixture(t), started = deferred();
  const runtime = new SubagentRuntime("parent", dir, { async run(_r, _p, signal) { started.resolve(); return aborted(signal); }, async notify() {} }, () => settings);
  const controller = new AbortController(), running = runtime.launch(input("cancel"), "one", controller.signal);
  await started.promise; controller.abort(new Error("User stopped")); assert.equal((await running).status, "cancelled");
  settings.timeoutSeconds = .02;
  const timed = await runtime.launch(input("timeout"), "two"); assert.equal(timed.status, "failed"); assert.match(timed.error, /timed out/);
});

test("token budget counts across tasks and aborts at reported usage boundaries", async t => {
  const { dir, settings } = await fixture(t); settings.maxTokens = 50;
  const runtime = new SubagentRuntime("parent", dir, { async run(_r, _p, signal, progress) { progress(50, 1); signal.throwIfAborted(); return "should not complete"; }, async notify() {} }, () => settings);
  const result = await runtime.launch(input("budget"), "one");
  assert.equal(result.status, "failed"); assert.match(result.error, /budget/); assert.equal(result.totalTokens, 50);
  await assert.rejects(runtime.launch(input("after"), "two"), /budget/);
});

test("disabling through the real settings endpoint cancels existing tasks and rejects new ones", async t => {
  const { dir, settings } = await fixture(t), started = deferred(); writeSubagentSettings(settings);
  const runtime = new SubagentRuntime("parent", dir, { async run(_r,_p,signal) { started.resolve(); return aborted(signal); }, async notify() {} });
  const detach = bindSubagentRuntime(runtime); t.after(detach);
  const running = runtime.launch(input("stop-on-disable"), "one"); await started.promise;
  assert.equal((await put({ ...settings, enabled: false })).status, 200);
  assert.equal((await running).status, "cancelled"); await assert.rejects(runtime.launch(input("disabled"), "two"), /disabled/);
});

test("SendMessage reuses an owned child context and restart never silently repeats work", async t => {
  const { dir, settings } = await fixture(t); let calls = 0;
  const driver = { async run(record) { calls++; record.childSessionFile ??= "saved-child.jsonl"; return `${calls}:${record.prompt}`; }, async notify() {} };
  const runtime = new SubagentRuntime("parent", dir, driver, () => settings), first = await runtime.launch(input("first"), "one");
  const resumed = new SubagentRuntime("parent", dir, driver, () => settings);
  const second = await resumed.continue(first.agentId, "next"); assert.equal(second.agentId, first.agentId); assert.equal(second.result, "2:next");
  await assert.rejects(new SubagentRuntime("another", dir, driver, () => settings).continue(first.agentId, "intrusion"), /belong/);
  saveSubagent({ ...second, status: "running" });
  const afterCrash = new SubagentRuntime("parent", dir, driver, () => settings);
  assert.equal(afterCrash.get(first.agentId).status, "interrupted"); assert.equal(calls, 2);
});
