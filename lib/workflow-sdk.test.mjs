import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { createJiti } from "jiti";
import { Type } from "typebox";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createSdkTestFixture } from "./pi-sdk-test-fixture.mjs";
const jiti = createJiti(import.meta.url);
const { WorkflowStore } = await jiti.import("./workflow-store.ts");
const { getWorkflowRuntime } = await jiti.import("./workflow-runtime.ts");
const { createWorkflowExtension } = await jiti.import("../extensions/piora-workflows.ts");
const { writeLaboratorySettings } = await jiti.import("./laboratory-settings.ts");
const { buildSessionContext } = await jiti.import("./session-reader.ts");
const {
  MAX_INCOMPLETE_RESUMES_PER_TURN,
  WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE,
  WORKFLOW_INCOMPLETE_RESUME_CUSTOM_TYPE,
} = await jiti.import("./workflow/goal-continuation.ts");
function enableLaboratory(t, agentDir) {
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeLaboratorySettings({ planGoalEnabled: true });
  t.after(() => {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
  });
}
function tool(id, name, args) { return { type: "toolCall", id, name, arguments: args }; }
function registerControlledCrossFeatureTools(api, calls) {
  api.registerTool({ name: "Agent", label: "Subagent", description: "Controlled delegation fixture",
    parameters: Type.Object({ description: Type.String() }),
    execute: async (_id, params) => { calls.push({ tool: "Agent", ...params }); return { content: [{ type: "text", text: "delegated" }] }; } });
  api.registerTool({ name: "browser", label: "Browser", description: "Controlled browser fixture",
    parameters: Type.Object({ action: Type.String(), url: Type.Optional(Type.String()) }),
    execute: async (_id, params) => { calls.push({ tool: "browser", ...params }); return { content: [{ type: "text", text: "observed" }] }; } });
}
test("real SDK plan blocks writes, saves review, and continues the approved plan", { timeout: 20_000 }, async t => {
  let store;
  const fixture = await createSdkTestFixture(t, { toolNames: null,
    extension: api => createWorkflowExtension({ store })(api),
    step: request => {
      if (request.index === 0) return [tool("blocked-write", "write", { path: "must-not-exist.txt", content: "bad" })];
      if (request.index === 1) return [tool("plan", "piora_submit_plan", { title: "Implement safely", markdown: "# Goal\nCreate the approved file\n# Steps\nWrite approved.txt\n# Verify\nRead it" })];
      if (request.index === 3) return [tool("approved-write", "write", { path: "approved.txt", content: "ok" })];
      return [{ type: "text", text: "Finished this turn" }];
    },
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create();
  const runtime = getWorkflowRuntime(session.sessionId, store);
  assert.equal(runtime.isAttached, true);
  runtime.configure({ mode: "plan" }); runtime.preparePrompt("Create the approved file");
  await session.prompt("Create the approved file");
  await assert.rejects(access(join(fixture.cwd, "must-not-exist.txt")));
  assert.equal(runtime.getSnapshot().current.status, "awaiting_approval");
  const state = runtime.getSnapshot();
  const { prompt } = runtime.action({ action: "approve", runId: state.current.id, expectedRevision: state.revision });
  await session.prompt(prompt); runtime.onPromptSettled();
  await access(join(fixture.cwd, "approved.txt"));
  assert.equal(runtime.getSnapshot().current.status, "completed");
});
test("real SDK Plan blocks subagent delegation and browser interaction until approval", { timeout: 20_000 }, async t => {
  let store;
  const calls = [];
  const fixture = await createSdkTestFixture(t, { toolNames: null,
    extension: api => {
      registerControlledCrossFeatureTools(api, calls);
      createWorkflowExtension({ store })(api);
    },
    step: request => {
      if (request.index === 0) return [
        tool("plan-agent", "Agent", { description: "Do implementation" }),
        tool("plan-click", "browser", { action: "click" }),
        tool("plan-open", "browser", { action: "open", url: "http://127.0.0.1/fixture" }),
        tool("plan-snapshot", "browser", { action: "snapshot" }),
      ];
      if (request.index === 1) return [tool("submit", "piora_submit_plan", { title: "Review", markdown: "# Plan\nInspect first, then implement after approval." })];
      if (request.index === 3) return [
        tool("approved-agent", "Agent", { description: "Implement approved plan" }),
        tool("approved-click", "browser", { action: "click" }),
      ];
      return [{ type: "text", text: "Finished this turn" }];
    },
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create();
  const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "plan" }); runtime.preparePrompt("Prepare an implementation plan");
  await session.prompt("Prepare an implementation plan");
  assert.deepEqual(calls, [
    { tool: "browser", action: "open", url: "http://127.0.0.1/fixture" },
    { tool: "browser", action: "snapshot" },
  ]);
  assert.match(JSON.stringify(fixture.requests[1].messages), /This tool\/action was not executed/);
  assert.equal(runtime.getSnapshot().current.status, "awaiting_approval");
  const state = runtime.getSnapshot();
  const { prompt } = runtime.action({ action: "approve", runId: state.current.id, expectedRevision: state.revision });
  await session.prompt(prompt); runtime.onPromptSettled();
  assert.deepEqual(calls.slice(2), [
    { tool: "Agent", description: "Implement approved plan" },
    { tool: "browser", action: "click" },
  ]);
  assert.equal(runtime.getSnapshot().current.status, "completed");
});
test("real SDK Goal permits subagent and browser work while running but fences calls after completion", { timeout: 20_000 }, async t => {
  let store;
  const calls = [];
  const fixture = await createSdkTestFixture(t, { toolNames: null,
    extension: api => { registerControlledCrossFeatureTools(api, calls); createWorkflowExtension({ store })(api); },
    step: request => {
      if (request.index === 0) return [
        tool("goal-agent", "Agent", { description: "Inspect the goal" }),
        tool("goal-browser", "browser", { action: "snapshot" }),
      ];
      if (request.index === 1) return [tool("goal-complete", "piora_update_goal", {
        progress: "The controlled observations were collected", status: "completed",
        criteria: [{ id: "observed", text: "Inspect the goal", evidence: "Controlled tool observations", status: "verified" }],
      })];
      if (request.index === 2) return [
        tool("late-agent", "Agent", { description: "This must not execute" }),
        tool("late-browser", "browser", { action: "click" }),
      ];
      return [{ type: "text", text: "Goal completed" }];
    },
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create();
  const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 3 }); runtime.preparePrompt("Inspect the goal");
  await session.prompt("Inspect the goal");
  assert.deepEqual(calls, [
    { tool: "Agent", description: "Inspect the goal" },
    { tool: "browser", action: "snapshot" },
  ]);
  assert.match(JSON.stringify(fixture.requests[3].messages), /goal is no longer running/i);
  assert.equal(runtime.getSnapshot().current.status, "completed");
});
test("real SDK goal continues across agent_end and stops at the configured turn budget", { timeout: 20_000 }, async t => {
  let store;
  const fixture = await createSdkTestFixture(t, { toolNames: null, extension: api => createWorkflowExtension({ store })(api), step: request => [{ type: "text", text: `Progress turn ${request.index}` }] });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 2 }); runtime.preparePrompt("Complete all acceptance requirements");
  await session.prompt("Complete all acceptance requirements");
  assert.equal(fixture.requests.length, 2);
  assert.equal(runtime.getSnapshot().current.status, "budget_exhausted");
  assert.equal(runtime.getSnapshot().current.turnsUsed, 2);
  assert.ok(fixture.requests.every(request => request.systemPrompt.includes("Complete all acceptance requirements")));
});

test("real SDK completion records evidence, stops continuation, and keeps third-party commands available", { timeout: 20_000 }, async t => {
  let store;
  const invoked = [];
  const fixture = await createSdkTestFixture(t, { toolNames: null,
    extension: api => {
      api.registerCommand("plan", { handler: async () => { invoked.push("plan"); } });
      api.registerCommand("goal", { handler: async () => { invoked.push("goal"); } });
      createWorkflowExtension({ store })(api);
    },
    step: request => request.index === 0 ? [tool("complete-goal", "piora_update_goal", {
      progress: "Verified required output", status: "completed", criteria: [{ id: "output", text: "Output observed", evidence: "Observed output in the controlled test", status: "verified" }],
    })] : [{ type: "text", text: "Goal complete" }],
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 10 }); runtime.preparePrompt("Produce the required output");
  await session.prompt("Produce the required output");
  assert.equal(fixture.requests.length, 2); // Tool call and final answer, one logical goal turn.
  assert.equal(runtime.getSnapshot().current.status, "completed");
  assert.equal(runtime.getSnapshot().current.turnsUsed, 1);
  assert.equal(runtime.getSnapshot().current.criteria[0].evidence, "Observed output in the controlled test");
  await session.prompt("/plan"); await session.prompt("/goal");
  assert.deepEqual(invoked, ["plan", "goal"]);
});

test("real SDK cancellation stops queued goals and explicit resume preserves the objective", { timeout: 20_000 }, async t => {
  let store, started;
  const ready = new Promise(resolve => { started = resolve; });
  let hold = true;
  const fixture = await createSdkTestFixture(t, { toolNames: null, extension: api => createWorkflowExtension({ store })(api),
    step: async request => {
      if (hold) { started(); await new Promise(() => {}); }
      return [{ type: "text", text: `Resumed ${request.index}` }];
    },
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 1 }); runtime.preparePrompt("Preserve this exact goal");
  const running = session.prompt("Preserve this exact goal"); await ready;
  runtime.onAbort(); await session.abort(); await running;
  assert.equal(runtime.getSnapshot().current.status, "paused");
  assert.equal(fixture.requests.length, 1);
  const state = runtime.getSnapshot(); hold = false;
  const result = runtime.action({ action: "resume", runId: state.current.id, expectedRevision: state.revision });
  runtime.preparePrompt(result.prompt); await session.prompt(result.prompt);
  assert.equal(runtime.getSnapshot().current.objective, "Preserve this exact goal");
  assert.equal(runtime.getSnapshot().current.status, "budget_exhausted");
});

test("latest goal state is re-injected after real SDK context compaction", { timeout: 20_000 }, async t => {
  let store;
  const fixture = await createSdkTestFixture(t, { toolNames: null, compaction: true, extension: api => createWorkflowExtension({ store })(api),
    step: () => [{ type: "text", text: "Investigating the goal" }],
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 2 }); runtime.preparePrompt("Keep this objective after compaction");
  await session.prompt("Keep this objective after compaction");
  assert.ok(fixture.lifecycle.some(event => event.startsWith("compact:")));
  assert.ok(fixture.requests.at(-1).messages.some(message => JSON.stringify(message).includes("Keep this objective after compaction")));
  assert.equal(runtime.getSnapshot().current.status, "budget_exhausted");
});

test("real SDK cancellation fences a write waiting in an earlier extension tool hook", { timeout: 20_000 }, async t => {
  let store, releaseGate, enterGate;
  const gateEntered = new Promise(resolve => { enterGate = resolve; });
  const gate = new Promise(resolve => { releaseGate = resolve; });
  const fixture = await createSdkTestFixture(t, { toolNames: null,
    extension: api => {
      api.on("tool_call", async event => {
        if (event.toolName === "write") { enterGate(); await gate; }
      });
      createWorkflowExtension({ store })(api);
    },
    step: request => request.index === 0
      ? [tool("cancelled-write", "write", { path: "cancelled-write.txt", content: "must never be written" })]
      : [{ type: "text", text: "Finished" }],
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal" }); runtime.preparePrompt("Write only while this goal is active");
  const running = session.prompt("Write only while this goal is active");
  try {
    await gateEntered;
    const state = runtime.getSnapshot();
    runtime.action({ action: "cancel", runId: state.current.id, expectedRevision: state.revision });
    const aborting = session.abort();
    releaseGate();
    await aborting; await running;
    await assert.rejects(access(join(fixture.cwd, "cancelled-write.txt")), { code: "ENOENT" });
    assert.equal(runtime.getSnapshot().current.status, "cancelled");
    assert.equal(runtime.getSnapshot().mode, "agent");
  } finally {
    releaseGate(); await session.abort(); await running;
  }
});

test("real SDK stops automatic Goal continuation after laboratory is disabled and resumes only after opt-in", { timeout: 20_000 }, async t => {
  let store;
  const fixture = await createSdkTestFixture(t, { toolNames: null, extension: api => createWorkflowExtension({ store })(api),
    step: request => {
      if (request.index === 0) writeLaboratorySettings({ planGoalEnabled: false });
      return [{ type: "text", text: "Completed the current investigation turn" }];
    },
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 2 }); runtime.preparePrompt("Keep the complete original goal");
  await session.prompt("Keep the complete original goal");
  const paused = runtime.getSnapshot();
  assert.equal(fixture.requests.length, 1);
  assert.equal(paused.current.status, "paused");
  assert.equal(paused.current.reason, "laboratory_disabled");
  assert.equal(paused.current.turnsUsed, 1);
  const resume = { action: "resume", runId: paused.current.id, expectedRevision: paused.revision };
  assert.throws(() => runtime.action(resume), /Settings > Laboratory/);
  writeLaboratorySettings({ planGoalEnabled: true });
  assert.deepEqual(runtime.getSnapshot(), paused);
  const result = runtime.action(resume);
  runtime.preparePrompt(result.prompt); await session.prompt(result.prompt);
  assert.equal(fixture.requests.length, 2);
  assert.equal(runtime.getSnapshot().current.id, paused.current.id);
  assert.equal(runtime.getSnapshot().current.objective, paused.current.objective);
  assert.equal(runtime.getSnapshot().current.status, "budget_exhausted");
});

test("real SDK Goal resumes thinking-only responses silently within the same turn without burning budget", { timeout: 20_000 }, async t => {
  let store;
  const fixture = await createSdkTestFixture(t, {
    toolNames: null,
    extension: api => createWorkflowExtension({ store })(api),
    step: request => {
      if (request.index === 0) return [{ type: "thinking", thinking: "先分析工作区情况" }];
      if (request.index === 1) return [tool("complete-after-thinking", "piora_update_goal", {
        progress: "已完成分析与验证", status: "completed",
        criteria: [{ id: "c1", text: "完成目标", evidence: "已执行工具并确认输出", status: "verified" }],
      })];
      return [{ type: "text", text: "任务已全部完成" }];
    },
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 3 }); runtime.preparePrompt("在单轮内完成目标");
  await session.prompt("在单轮内完成目标");
  assert.equal(fixture.requests.length, 3);
  assert.equal(runtime.getSnapshot().current.status, "completed");
  assert.equal(runtime.getSnapshot().current.turnsUsed, 1);
  const entries = session.sessionManager.getEntries();
  assert.equal(entries.some(e => e.type === "custom_message" && e.customType === WORKFLOW_INCOMPLETE_RESUME_CUSTOM_TYPE), true);
  assert.equal(entries.some(e => e.type === "custom_message" && e.customType === WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE), false);
});

test("real SDK Goal resumes non-recoverable length-truncated responses silently within the same turn", { timeout: 20_000 }, async t => {
  let store;
  let fixture;
  const baseUsage = { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  fixture = await createSdkTestFixture(t, {
    toolNames: null,
    extension: api => createWorkflowExtension({ store })(api),
    streamProvider: (model) => {
      const idx = fixture.requests.length - 1;
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        if (idx === 0) {
          const message = {
            role: "assistant", api: model.api, provider: model.provider, model: model.id,
            content: [{ type: "thinking", thinking: "超长思考中途被 max_tokens 截断" }],
            timestamp: Date.now(),
            usage: { ...baseUsage, output: model.maxTokens, totalTokens: 10 + model.maxTokens },
            stopReason: "length",
          };
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: "length", message });
          return;
        }
        const content = idx === 1
          ? [tool("complete-after-length", "piora_update_goal", {
              progress: "截断恢复后完成", status: "completed",
              criteria: [{ id: "c1", text: "验证通过", evidence: "恢复后执行完成", status: "verified" }],
            })]
          : [{ type: "text", text: "截断恢复并已完成" }];
        const stopReason = idx === 1 ? "toolUse" : "stop";
        const message = {
          role: "assistant", api: model.api, provider: model.provider, model: model.id,
          content, timestamp: Date.now(), usage: baseUsage, stopReason,
        };
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: stopReason, message });
      });
      return stream;
    },
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 3 }); runtime.preparePrompt("处理长输出截断后继续完成");
  await session.prompt("处理长输出截断后继续完成");
  assert.equal(fixture.requests.length, 3);
  assert.equal(runtime.getSnapshot().current.status, "completed");
  assert.equal(runtime.getSnapshot().current.turnsUsed, 1);
  const resumeEntry = session.sessionManager.getEntries().find(
    e => e.type === "custom_message" && e.customType === WORKFLOW_INCOMPLETE_RESUME_CUSTOM_TYPE,
  );
  assert.ok(resumeEntry);
  assert.equal(resumeEntry.details?.kind, "incomplete_truncated");
  assert.equal(
    session.sessionManager.getEntries().some(e => e.type === "custom_message" && e.customType === WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE),
    false,
  );
});

test("real SDK Goal bounds repeated incomplete-turn resumes so a looping model hits budget safely", { timeout: 20_000 }, async t => {
  let store;
  const fixture = await createSdkTestFixture(t, {
    toolNames: null,
    extension: api => createWorkflowExtension({ store })(api),
    step: () => [{ type: "thinking", thinking: "只思考不输出也不调工具" }],
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 2 }); runtime.preparePrompt("测试有界恢复");
  await session.prompt("测试有界恢复");
  assert.equal(fixture.requests.length, 2 * (MAX_INCOMPLETE_RESUMES_PER_TURN + 1));
  assert.equal(runtime.getSnapshot().current.status, "budget_exhausted");
  assert.equal(runtime.getSnapshot().current.turnsUsed, 2);
  const continueEntries = session.sessionManager.getEntries().filter(
    e => e.type === "custom_message" && e.customType === WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE,
  );
  assert.equal(continueEntries.length, 1);
});

test("real SDK Goal keeps toolResult at the tail of subsequent requests without trailing user messages", { timeout: 20_000 }, async t => {
  let store;
  const fixture = await createSdkTestFixture(t, {
    toolNames: null,
    resourceFiles: { "note.txt": "hello world" },
    extension: api => createWorkflowExtension({ store })(api),
    step: request => {
      if (request.index === 0) return [tool("read-note", "read", { path: "note.txt" })];
      if (request.index === 1) return [tool("finish-goal", "piora_update_goal", {
        progress: "已读取 note.txt", status: "completed",
        criteria: [{ id: "read", text: "读取文件", evidence: "hello world", status: "verified" }],
      })];
      return [{ type: "text", text: "全部完成" }];
    },
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 3 }); runtime.preparePrompt("读取 note.txt 并完成目标");
  await session.prompt("读取 note.txt 并完成目标");
  assert.equal(fixture.requests.length, 3);
  assert.equal(fixture.requests[1].messages.at(-1).role, "toolResult");
  assert.equal(fixture.requests[2].messages.at(-1).role, "toolResult");
  assert.ok(
    fixture.requests[1].messages.some(m => m.role === "user" && JSON.stringify(m).includes("<piora_workflow_state>")),
  );
  assert.equal(runtime.getSnapshot().current.status, "completed");
});

test("real SDK Goal pauses instead of continuing when a tool batch terminates execution", { timeout: 20_000 }, async t => {
  let store;
  const fixture = await createSdkTestFixture(t, {
    toolNames: null,
    extension: api => createWorkflowExtension({ store })(api),
    step: request => request.index === 0
      ? [tool("denied-write", "write", { path: "denied.txt", content: "blocked" })]
      : [{ type: "text", text: "不应继续到这里" }],
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  session.agent.beforeToolCall = async () => ({ block: true, terminate: true, reason: "Denied" });
  runtime.configure({ mode: "goal", turnBudget: 3 }); runtime.preparePrompt("被拒绝时应暂停目标");
  await session.prompt("被拒绝时应暂停目标");
  assert.equal(fixture.requests.length, 1);
  assert.equal(runtime.getSnapshot().current.status, "paused");
  assert.equal(runtime.getSnapshot().current.reason, "user_stopped");
  assert.equal(
    session.sessionManager.getEntries().some(e => e.type === "custom_message" && e.customType === WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE),
    false,
  );
});

test("real SDK Goal emits Chinese continuation messages and hides internal incomplete-turn resumes from UI context", { timeout: 20_000 }, async t => {
  let store;
  const fixture = await createSdkTestFixture(t, {
    toolNames: null,
    extension: api => createWorkflowExtension({ store })(api),
    step: request => {
      if (request.index === 0) return [{ type: "thinking", thinking: "先思考一会" }];
      if (request.index === 1) return [{ type: "text", text: "第一轮先汇报阶段进展" }];
      if (request.index === 2) return [tool("finish-turn-2", "piora_update_goal", {
        progress: "第二轮完成目标", status: "completed",
        criteria: [{ id: "done", text: "目标完成", evidence: "实测完成", status: "verified" }],
      })];
      return [{ type: "text", text: "第二轮全部完成" }];
    },
  });
  enableLaboratory(t, fixture.agentDir);
  store = new WorkflowStore(join(fixture.agentDir, "workflows"));
  const session = await fixture.create(); const runtime = getWorkflowRuntime(session.sessionId, store);
  runtime.configure({ mode: "goal", turnBudget: 3 }); runtime.preparePrompt("验证中文续跑与隐藏恢复过滤");
  await session.prompt("验证中文续跑与隐藏恢复过滤");
  assert.equal(runtime.getSnapshot().current.status, "completed");
  assert.equal(runtime.getSnapshot().current.turnsUsed, 2);

  const entries = session.sessionManager.getEntries();
  const continueEntry = entries.find(
    e => e.type === "custom_message" && e.customType === WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE,
  );
  assert.ok(continueEntry);
  assert.equal(continueEntry.display, true);
  assert.match(String(continueEntry.content), /请继续推进当前目标/);
  assert.doesNotMatch(String(continueEntry.content), /Continue the current goal/);

  const uiContext = buildSessionContext(entries);
  assert.equal(
    uiContext.messages.some(m => m.role === "custom" && m.customType === WORKFLOW_INCOMPLETE_RESUME_CUSTOM_TYPE),
    false,
  );
  assert.equal(
    uiContext.messages.some(
      m => m.role === "custom" && m.customType === WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE && String(m.content).includes("请继续推进当前目标"),
    ),
    true,
  );
});
