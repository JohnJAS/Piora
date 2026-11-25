import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  buildIncompleteTurnResumePrompt,
  classifyGoalAssistantOutcome,
  extractAppendedCustomMessage,
  injectWorkflowContextIntoMessages,
  serializeWorkflowContextSnapshot,
  WORKFLOW_CONTEXT_CUSTOM_TYPE,
  WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE,
  WORKFLOW_INCOMPLETE_RESUME_CUSTOM_TYPE,
} = await jiti.import("./goal-continuation.ts");

test("classifyGoalAssistantOutcome distinguishes thinking-only, truncated, terminated tool batch, errors, and completed turns", () => {
  assert.equal(classifyGoalAssistantOutcome(undefined), "error");
  assert.equal(classifyGoalAssistantOutcome({ role: "assistant", stopReason: "aborted", content: [] }), "aborted");
  assert.equal(classifyGoalAssistantOutcome({ role: "assistant", stopReason: "error", content: [] }), "error");
  assert.equal(
    classifyGoalAssistantOutcome({
      role: "assistant",
      stopReason: "toolUse",
      content: [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }],
    }),
    "terminated_tool_batch",
  );
  assert.equal(
    classifyGoalAssistantOutcome({
      role: "assistant",
      stopReason: "length",
      content: [{ type: "thinking", thinking: "正在推理…" }],
    }),
    "incomplete_truncated",
  );
  assert.equal(
    classifyGoalAssistantOutcome({
      role: "assistant",
      stopReason: "length",
      content: [{ type: "text", text: "部分正文" }],
    }),
    "incomplete_truncated",
  );
  assert.equal(
    classifyGoalAssistantOutcome({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "thinking", thinking: "只思考了一段" }],
    }),
    "incomplete_thinking_only",
  );
  assert.equal(
    classifyGoalAssistantOutcome({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "thinking", thinking: "思考" }, { type: "text", text: "   \n  " }],
    }),
    "incomplete_thinking_only",
  );
  assert.equal(
    classifyGoalAssistantOutcome({
      role: "assistant",
      stopReason: "toolUse",
      content: [{ type: "thinking", thinking: "无实际工具调用" }],
    }),
    "incomplete_thinking_only",
  );
  assert.equal(
    classifyGoalAssistantOutcome({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "阶段成果已输出" }],
    }),
    "completed_turn",
  );

  assert.match(buildIncompleteTurnResumePrompt("incomplete_truncated"), /长度限制被截断/);
  assert.match(buildIncompleteTurnResumePrompt("incomplete_thinking_only"), /只输出了思考过程/);
});

test("serializeWorkflowContextSnapshot omits volatile timestamps to preserve KV cache", () => {
  const baseRun = {
    id: "run-1",
    kind: "goal",
    status: "running",
    objective: "完成目标并验证",
    title: "",
    markdown: "",
    criteria: [{ id: "c1", text: "测试通过", evidence: "", status: "pending" }],
    progress: "已检查代码",
    reason: "",
    turnBudget: 10,
    turnsUsed: 0,
    noProgressTurns: 0,
    version: 1,
    createdAt: 1000,
    updatedAt: 2000,
    activeSince: 2000,
    timeUsedMs: 123,
  };
  const first = serializeWorkflowContextSnapshot(baseRun);
  const later = serializeWorkflowContextSnapshot({
    ...baseRun,
    updatedAt: 999999,
    activeSince: 999999,
    timeUsedMs: 88888,
  });
  assert.equal(first, later);
  assert.match(first, /<piora_workflow_state>/);
  assert.match(first, /完成目标并验证/);
  assert.doesNotMatch(first, /updatedAt|activeSince|timeUsedMs|createdAt/);
});

test("injectWorkflowContextIntoMessages keeps toolResult at tail and avoids consecutive user messages", () => {
  const stateText = "<piora_workflow_state>\nstate\n</piora_workflow_state>";

  const firstTurn = [{ role: "user", content: "原始目标" }];
  const injectedFirst = injectWorkflowContextIntoMessages(firstTurn, stateText);
  assert.equal(injectedFirst.length, 1);
  assert.equal(injectedFirst[0].role, "user");
  assert.equal(injectedFirst[0].content, `${stateText}\n\n原始目标`);
  assert.equal(firstTurn[0].content, "原始目标");

  const arrayUser = [
    {
      role: "user",
      content: [
        { type: "text", text: "看这张图" },
        { type: "image", data: "YWJj", mimeType: "image/png" },
      ],
    },
  ];
  const injectedArray = injectWorkflowContextIntoMessages(arrayUser, stateText);
  assert.equal(injectedArray.length, 1);
  assert.deepEqual(injectedArray[0].content, [
    { type: "text", text: stateText },
    { type: "text", text: "看这张图" },
    { type: "image", data: "YWJj", mimeType: "image/png" },
  ]);

  const afterTool = [
    { role: "user", content: "原始目标" },
    { role: "assistant", content: [{ type: "toolCall", id: "1", name: "read", arguments: {} }] },
    { role: "toolResult", toolCallId: "1", content: [{ type: "text", text: "ok" }] },
  ];
  const injectedAfterTool = injectWorkflowContextIntoMessages(afterTool, stateText);
  assert.equal(injectedAfterTool.length, 3);
  assert.equal(injectedAfterTool.at(-1).role, "toolResult");
  assert.match(injectedAfterTool[0].content, /<piora_workflow_state>/);

  const afterCompaction = [
    { role: "compactionSummary", summary: "压缩摘要", tokensBefore: 1000, timestamp: 1 },
    { role: "assistant", content: [{ type: "toolCall", id: "2", name: "read", arguments: {} }] },
    { role: "toolResult", toolCallId: "2", content: [{ type: "text", text: "ok" }] },
  ];
  const injectedCompaction = injectWorkflowContextIntoMessages(afterCompaction, stateText);
  assert.equal(injectedCompaction.length, 3);
  assert.equal(injectedCompaction.at(-1).role, "toolResult");
  assert.equal(injectedCompaction[0].summary, `${stateText}\n\n压缩摘要`);

  const afterContinuation = [
    { role: "user", content: "原始目标" },
    { role: "assistant", content: [{ type: "text", text: "阶段进展" }] },
    { role: "custom", customType: WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE, content: "请继续推进当前目标" },
    { role: "assistant", content: [{ type: "toolCall", id: "3", name: "bash", arguments: {} }] },
    { role: "toolResult", toolCallId: "3", content: [{ type: "text", text: "ok" }] },
  ];
  const injectedContinuation = injectWorkflowContextIntoMessages(afterContinuation, stateText);
  assert.equal(injectedContinuation.length, 5);
  assert.equal(injectedContinuation.at(-1).role, "toolResult");
  assert.equal(injectedContinuation[0].content, "原始目标");
  assert.equal(injectedContinuation[2].content, `${stateText}\n\n请继续推进当前目标`);

  const fallback = [
    { role: "assistant", content: [{ type: "toolCall", id: "4", name: "read", arguments: {} }] },
    { role: "toolResult", toolCallId: "4", content: [{ type: "text", text: "ok" }] },
  ];
  const injectedFallback = injectWorkflowContextIntoMessages(fallback, stateText);
  assert.equal(injectedFallback.length, 3);
  assert.equal(injectedFallback[0].role, "custom");
  assert.equal(injectedFallback[0].customType, WORKFLOW_CONTEXT_CUSTOM_TYPE);
  assert.equal(injectedFallback.at(-1).role, "toolResult");
});

test("extractAppendedCustomMessage surfaces only visible Goal continuation entries", () => {
  const visible = extractAppendedCustomMessage({
    type: "custom_message",
    customType: WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE,
    content: "请继续推进当前目标",
    display: true,
    details: { completedTurns: 1, turnBudget: 10 },
    timestamp: "2026-11-23T08:00:00.000Z",
  });
  assert.deepEqual(visible, {
    role: "custom",
    customType: WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE,
    content: "请继续推进当前目标",
    display: true,
    details: { completedTurns: 1, turnBudget: 10 },
    timestamp: Date.parse("2026-11-23T08:00:00.000Z"),
  });

  assert.equal(
    extractAppendedCustomMessage({
      type: "custom_message",
      customType: WORKFLOW_INCOMPLETE_RESUME_CUSTOM_TYPE,
      content: "hidden",
      display: true,
    }),
    null,
  );
  assert.equal(
    extractAppendedCustomMessage({
      type: "custom_message",
      customType: WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE,
      content: "hidden",
      display: false,
    }),
    null,
  );
  assert.equal(
    extractAppendedCustomMessage({
      type: "custom_message",
      customType: "piora-side-boundary",
      content: "side",
      display: true,
    }),
    null,
  );
  assert.equal(
    extractAppendedCustomMessage({
      type: "custom",
      customType: WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE,
      content: "not custom_message",
    }),
    null,
  );
});
