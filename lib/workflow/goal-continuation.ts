import type { CustomMessage } from "../types.ts";
import type { WorkflowRun, WorkflowTodoStep } from "../workflow-types.ts";

export const WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE = "piora-goal-continue";
export const WORKFLOW_INCOMPLETE_RESUME_CUSTOM_TYPE = "piora-workflow-incomplete-resume";
export const WORKFLOW_CONTEXT_CUSTOM_TYPE = "piora-workflow-context";
export const MAX_INCOMPLETE_RESUMES_PER_TURN = 2;

export const GOAL_CONTINUATION_PROMPT_ZH =
  "请继续推进当前目标，保持原始目标和验收标准不变。优先直接调用工具完成实质工作；使用 piora_update_steps 更新步骤进度，使用 piora_update_goal 记录最新进展和实测验收证据；如需用户补充信息或遇到阻塞，请将其标记为 waiting 并说明具体原因；只有在所有验收标准都具备实际验证证据后，才能标记为 completed。";

export const GOAL_RESUME_PROMPT_ZH =
  "请继续推进当前目标，沿用已保存的原始目标、验收标准和既有证据；在采取进一步操作前先核对当前工作区状态。";

export const PLAN_RESUME_PROMPT_ZH =
  "请继续完善当前计划，提交完整的修订版计划供审核，不要直接实施修改。";

export type GoalAssistantOutcome =
  | "aborted"
  | "error"
  | "terminated_tool_batch"
  | "incomplete_truncated"
  | "incomplete_thinking_only"
  | "completed_turn";

interface AssistantMessageLike {
  role?: unknown;
  stopReason?: unknown;
  content?: unknown;
}

interface ContextMessageLike {
  role?: string;
  customType?: string;
  content?: unknown;
  summary?: string;
}

/** Classify an assistant response at Goal turn settlement before consuming budget or issuing continuation. */
export function classifyGoalAssistantOutcome(message: AssistantMessageLike | null | undefined): GoalAssistantOutcome {
  if (!message) return "error";
  if (message.stopReason === "aborted") return "aborted";
  if (message.stopReason === "error") return "error";

  const blocks = Array.isArray(message.content) ? message.content : [];
  const hasToolCalls = blocks.some(
    (block) => Boolean(block && typeof block === "object" && (block as { type?: unknown }).type === "toolCall"),
  );
  const hasVisibleText = blocks.some((block) => {
    if (!block || typeof block !== "object") return false;
    const candidate = block as { type?: unknown; text?: unknown };
    return candidate.type === "text" && typeof candidate.text === "string" && candidate.text.trim().length > 0;
  });

  if (message.stopReason === "toolUse" && hasToolCalls) return "terminated_tool_batch";
  if (message.stopReason === "length" && !hasToolCalls) return "incomplete_truncated";
  if (!hasToolCalls && !hasVisibleText) return "incomplete_thinking_only";
  return "completed_turn";
}

export function buildIncompleteTurnResumePrompt(kind: "incomplete_truncated" | "incomplete_thinking_only"): string {
  if (kind === "incomplete_truncated") {
    return "你上一条输出因长度限制被截断，尚未完成本轮执行或工具调用。请紧接当前进度继续执行，优先调用工具推进任务或给出明确进展，不要重复已完成的思考或开场白。";
  }
  return "你刚才只输出了思考过程，尚未输出正文回复或调用工具，当前这一轮还没有真正完成。请直接基于刚才的思考立即调用工具推进任务，或给出清晰的阶段性结果；不要空转。";
}

/** Serialize stable workflow fields (omitting volatile timestamps) so KV cache prefixes remain stable across tool steps. */
export function serializeWorkflowContextSnapshot(run: WorkflowRun, todoSteps?: WorkflowTodoStep[]): string {
  const steps = todoSteps?.length ? todoSteps : run.steps;
  const stableState = {
    id: run.id,
    kind: run.kind,
    status: run.status,
    objective: run.objective,
    ...(run.title ? { title: run.title } : {}),
    ...(run.markdown ? { markdown: run.markdown } : {}),
    ...(run.criteria.length ? { criteria: run.criteria } : {}),
    ...(run.progress ? { progress: run.progress } : {}),
    ...(run.reason ? { reason: run.reason } : {}),
    turnBudget: run.turnBudget,
    turnsUsed: run.turnsUsed,
    version: run.version,
    ...(steps?.length ? { steps } : {}),
  };
  return `<piora_workflow_state>\n当前宿主工作流状态（在上下文压缩后仍会保留，请始终围绕原始目标推进）：\n${JSON.stringify(stableState)}\n</piora_workflow_state>`;
}

/**
 * Inject workflow state without appending a synthetic user message after toolResult
 * or creating back-to-back user messages that break interleaved reasoning/tool chains.
 */
export function injectWorkflowContextIntoMessages<T extends ContextMessageLike>(messages: T[], stateText: string): T[] {
  let targetIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    if (
      message.role === "user"
      || message.role === "compactionSummary"
      || (message.role === "custom" && message.customType !== WORKFLOW_CONTEXT_CUSTOM_TYPE)
    ) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex < 0) {
    const fallback = {
      role: "custom",
      customType: WORKFLOW_CONTEXT_CUSTOM_TYPE,
      display: false,
      timestamp: Date.now(),
      content: stateText,
    } as unknown as T;
    return [fallback, ...messages];
  }

  const target = messages[targetIndex];
  let updated: T;
  if (target.role === "compactionSummary") {
    updated = {
      ...target,
      summary: target.summary ? `${stateText}\n\n${target.summary}` : stateText,
    };
  } else if (typeof target.content === "string") {
    updated = {
      ...target,
      content: target.content ? `${stateText}\n\n${target.content}` : stateText,
    };
  } else if (Array.isArray(target.content)) {
    updated = {
      ...target,
      content: [{ type: "text", text: stateText }, ...target.content],
    };
  } else {
    updated = {
      ...target,
      content: stateText,
    };
  }

  return messages.map((message, index) => (index === targetIndex ? updated : message));
}

function parseEntryTimestamp(timestamp: unknown): number | undefined {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  if (typeof timestamp !== "string") return undefined;
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Extract visible Goal auto-continuation entries emitted via SDK `entry_appended` for live chat rendering. */
export function extractAppendedCustomMessage(entry: unknown): CustomMessage | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const raw = entry as {
    type?: unknown;
    customType?: unknown;
    content?: unknown;
    display?: unknown;
    details?: unknown;
    timestamp?: unknown;
  };
  if (raw.type !== "custom_message") return null;
  if (raw.display === false) return null;
  if (raw.customType !== WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE) return null;

  const content = typeof raw.content === "string"
    ? raw.content
    : Array.isArray(raw.content)
      ? raw.content
      : [];
  const timestamp = parseEntryTimestamp(raw.timestamp);

  return {
    role: "custom",
    customType: WORKFLOW_GOAL_CONTINUE_CUSTOM_TYPE,
    content: content as CustomMessage["content"],
    display: true,
    ...(raw.details !== undefined ? { details: raw.details } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
}
