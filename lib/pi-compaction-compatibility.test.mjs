import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  compact, generateBranchSummary, generateSummary, generateSummaryWithUsage,
  SessionManager, SettingsManager, shouldCompact,
} from "@earendil-works/pi-coding-agent";
import { applyCompactionThresholdSettings, installModelAwareCompactionSettings } from "./compaction-settings.ts";
import { createSdkTestFixture } from "./pi-sdk-test-fixture.mjs";

const model = {
  id: "summary-fixture", name: "Summary fixture", api: "openai-completions", provider: "fixture",
  baseUrl: "https://unused.invalid", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 32768,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const usage = { input: 200, output: 300, cacheRead: 0, cacheWrite: 0, totalTokens: 500, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const history = [{ role: "user", content: [{ type: "text", text: "Keep this exact context." }], timestamp: 0 }];

function summaryStream(requests, stopReason = "stop") {
  return (selected, context, options) => {
    requests.push({ selected, context, options });
    const stream = createAssistantMessageEventStream();
    const message = {
      role: "assistant", api: selected.api, provider: selected.provider, model: selected.id,
      content: [{ type: "text", text: "VERIFIED_SUMMARY " + "detail ".repeat(100) }],
      usage, stopReason, timestamp: 1,
    };
    queueMicrotask(() => stream.push({ type: "done", reason: stopReason, message }));
    return stream;
  };
}

function assertUncapped(request) {
  assert.equal(request.selected.maxTokens, 32768);
  assert.equal(Object.hasOwn(request.options, "maxTokens"), false, "SDK must leave output limit to the model");
  assert.equal(request.options.cacheRetention, "none");
}

test("saved Piora reserve preserves the SDK's strict threshold comparison", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "piora-compaction-compat-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  const records = { global: "{}", project: "{}" };
  const manager = SettingsManager.fromStorage({ withLock(scope, update) {
    const next = update(records[scope]);
    if (next !== undefined) records[scope] = next;
  } });
  installModelAwareCompactionSettings(manager);
  for (const reserveTokens of [0, 8192, 16384]) {
    await applyCompactionThresholdSettings(manager, { reserveTokens });
    const settings = manager.getCompactionSettings(model);
    const threshold = model.contextWindow - reserveTokens;
    assert.equal(shouldCompact(threshold, model.contextWindow, settings), false);
    assert.equal(shouldCompact(threshold + 1, model.contextWindow, settings), true);
    assert.equal(shouldCompact(threshold + 1, model.contextWindow, { ...settings, enabled: false }), false);
  }
});

test("a long tool result triggers compaction before the next model request, with the current turn intact", async t => {
  const dir = mkdtempSync(join(tmpdir(), "piora-compaction-compat-run-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  const summaries = [];
  const summarize = summaryStream(summaries);
  const toolName = "large_result";
  const f = await createSdkTestFixture(t, {
    modelLimits: { contextWindow: model.contextWindow, maxTokens: model.maxTokens },
    toolNames: [toolName],
    extension: pi => pi.registerTool({
      name: toolName, label: "Large result", description: "Push the fixture over the compaction threshold",
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "CURRENT_TOOL_RESULT " + "tool data ".repeat(3200) }] };
      },
    }),
    streamProvider(selected, context, options) {
      const index = f.requests.length - 1;
      if (index === 1) return summarize(selected, context, options);
      const stream = createAssistantMessageEventStream();
      const initial = index === 0;
      const content = initial
        ? [{ type: "toolCall", name: toolName, id: "call_result", arguments: {} }]
        : [{ type: "text", text: "TASK_CONTINUED" }];
      const stopReason = initial ? "toolUse" : "stop";
      const message = {
        role: "assistant", api: selected.api, provider: selected.provider, model: selected.id,
        content, usage: initial ? { ...usage, input: 108000, totalTokens: 108300 } : usage,
        stopReason, timestamp: Date.now(),
      };
      queueMicrotask(() => stream.push({ type: "done", reason: stopReason, message }));
      return stream;
    },
  });
  const manager = SessionManager.create(f.cwd, join(f.agentDir, "sessions"));
  for (let index = 0; index < 6; index++) {
    manager.appendMessage({ role: "user", content: `OLD_TURN_${index} ` + "historical note ".repeat(3200), timestamp: index * 2 });
    manager.appendMessage({
      role: "assistant", api: "piora-migration-api", provider: "piora-migration-test", model: "model",
      content: [{ type: "text", text: "Completed earlier task" }],
      usage: { ...usage, input: 85000, totalTokens: 85300 }, stopReason: "stop", timestamp: index * 2 + 1,
    });
  }
  const session = await f.create(manager);
  installModelAwareCompactionSettings(session.settingsManager);
  session.setAutoCompactionEnabled(true);
  const events = [];
  session.subscribe(event => { if (event.type === "compaction_start" || event.type === "compaction_end") events.push(event); });
  await session.prompt("CURRENT_TASK");

  assert.equal(f.requests.length, 3);
  assert.equal(summaries.length, 1);
  assert.match(JSON.stringify(f.requests[0].messages), /OLD_TURN_0/);
  assert.match(JSON.stringify(summaries[0].context.messages), /OLD_TURN_0/);
  const resumed = JSON.stringify(f.requests[2].messages);
  assert.match(resumed, /VERIFIED_SUMMARY/);
  assert.match(resumed, /CURRENT_TASK/);
  assert.match(resumed, /CURRENT_TOOL_RESULT/);
  assert.doesNotMatch(resumed, /OLD_TURN_0/);
  const persisted = SessionManager.open(session.sessionFile);
  assert.match(JSON.stringify(persisted.getEntries()), /OLD_TURN_0/);
  assert.ok(persisted.getEntries().some(entry => entry.type === "compaction" && entry.summary.includes("VERIFIED_SUMMARY")));
  assert.deepEqual(events.map(event => [event.type, event.reason]), [
    ["compaction_start", "threshold"], ["compaction_end", "threshold"],
  ]);
  const result = events[1].result;
  assert.ok(result.tokensBefore > 111616 && result.tokensBefore < 128000);
  assert.ok(result.estimatedTokensAfter < result.tokensBefore);
  assert.match(JSON.stringify(session.messages.at(-1)), /TASK_CONTINUED/);
});

test("Pi 1.4 summary helpers preserve usage, instructions and model output limit regardless of reserve", async () => {
  const requests = [];
  const stream = summaryStream(requests);
  for (const reserve of [0, 1, 16384]) {
    const result = await generateSummaryWithUsage(history, model, reserve, "fixture-key", undefined, undefined,
      "PRESERVE_CUSTOM_INSTRUCTIONS", "PREVIOUS_SUMMARY", "high", stream);
    assert.match(result.text, /VERIFIED_SUMMARY/);
    assert.deepEqual(result.usage, usage);
    assert.ok(result.usage.output > 1);
    const request = requests.at(-1);
    assertUncapped(request);
    assert.equal(request.options.reasoning, "high");
    assert.match(JSON.stringify(request.context), /PRESERVE_CUSTOM_INSTRUCTIONS/);
    assert.match(JSON.stringify(request.context), /PREVIOUS_SUMMARY/);
  }
  assert.match(await generateSummary(history, model, 1, "fixture-key", undefined, undefined,
    undefined, undefined, undefined, stream), /VERIFIED_SUMMARY/);
  assertUncapped(requests.at(-1));
});

test("Pi 1.4 branch and split-turn summaries retain instructions without a fixed output cap", async () => {
  const requests = [];
  const stream = summaryStream(requests);
  const branch = await generateBranchSummary([
    { type: "message", id: "history", parentId: null, timestamp: new Date(0).toISOString(), message: history[0] },
  ], { model, apiKey: "fixture-key", reserveTokens: 1, customInstructions: "BRANCH_FOCUS", streamFn: stream });
  assert.match(branch.summary, /VERIFIED_SUMMARY/);
  assert.deepEqual(branch.usage, usage);
  assert.match(JSON.stringify(requests.at(-1).context), /BRANCH_FOCUS/);
  assertUncapped(requests.at(-1));
  // No newly summarized history: the split prefix alone must retain /compact instructions.
  const result = await compact({
    firstKeptEntryId: "kept", messagesToSummarize: [], turnPrefixMessages: history, isSplitTurn: true,
    tokensBefore: 1000, previousSummary: "EXISTING_SUMMARY",
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: { enabled: true, reserveTokens: 1, keepRecentTokens: 50 },
  }, model, "fixture-key", undefined, "SPLIT_TURN_FOCUS", undefined, "high", stream);
  assert.match(result.summary, /EXISTING_SUMMARY/);
  assert.match(result.summary, /VERIFIED_SUMMARY/);
  assert.equal(result.firstKeptEntryId, "kept");
  assert.deepEqual(result.usage, usage);
  assert.match(JSON.stringify(requests.at(-1).context), /SPLIT_TURN_FOCUS/);
  assertUncapped(requests.at(-1));
});

test("uncapped SDK summaries still reject incomplete output rather than persisting it", async () => {
  await assert.rejects(generateSummary(history, model, 1, "fixture-key", undefined, undefined,
    undefined, undefined, undefined, summaryStream([], "length")), /token cap.*incomplete/);
  const branch = await generateBranchSummary([
    { type: "message", id: "history", parentId: null, timestamp: new Date(0).toISOString(), message: history[0] },
  ], { model, apiKey: "fixture-key", streamFn: summaryStream([], "length") });
  assert.match(branch.error, /token cap.*incomplete/);
  assert.equal(branch.summary, undefined);
});
