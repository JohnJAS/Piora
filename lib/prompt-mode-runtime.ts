import {
  advanceGoalIteration,
  forceBlockGoal,
  getGoalRun,
  type GoalRunState,
} from "./goal-run-registry";
import type { AgentSessionLike } from "./pi-types";
import type { PromptRunIdentity } from "./prompt-run-registry";

export type PromptMode = "normal" | "goal" | "plan";

export interface ActivePromptMode extends PromptRunIdentity {
  mode: Exclude<PromptMode, "normal">;
}

declare global {
  var __pioraPromptModes: Map<string, ActivePromptMode> | undefined;
}

function activePromptModes(): Map<string, ActivePromptMode> {
  return globalThis.__pioraPromptModes ??= new Map();
}

// piora_plan only persists structured plan metadata in the current Pi session.
// It cannot mutate the workspace or external state, so it is the sole
// extension tool allowed through the plan-mode read-only lease.
const PLAN_MODE_READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "piora_plan"]);

export const PLAN_MODE_SYSTEM_INSTRUCTION = `You are in plan mode. Analyze the request and return a concrete, decision-complete implementation plan.

Plan-mode rules:
- Inspect the relevant code and context before proposing the plan.
- Do not modify files, configuration, repositories, or external state.
- Do not run commands or tools that can write, install, delete, commit, push, deploy, or otherwise mutate state.
- Resolve straightforward details from the available code instead of asking unnecessary questions.
- If a missing user decision would materially change the implementation, state that decision clearly.
- Before your final response, call piora_plan exactly once with a structured, decision-complete plan. This stores plan metadata only and does not authorize execution.
- Give every plan step a short stable id. Dependencies must reference those ids, and success criteria must be objectively verifiable.
- End with a concise summary of the stored plan and make clear that it is waiting for user approval.

This instruction applies only to the current prompt.`;

export const GOAL_MODE_CONTINUATION = [
  "Piora target mode is still active. Continue working toward the original user objective now.",
  "Inspect current evidence and take the next useful action. Do not stop merely because this model turn can end.",
  "Use piora_goal progress after material milestones, complete only after verifying the outcome, or blocked only when an external change or user input is genuinely required.",
].join(" ");

// This is a runaway-loop safety fuse, not an estimate of how many turns a task should take.
// Keep it high enough for long device-control tasks while guaranteeing eventual termination.
export const GOAL_MODE_MAX_CONTINUATIONS = 64;

type PlanModeSession = Pick<AgentSessionLike, "getActiveToolNames" | "setActiveToolsByName">;

export interface PlanModeLease {
  readonly activeTools: readonly string[];
  restore(): void;
}

export function selectPlanModeTools(toolNames: readonly string[]): string[] {
  return toolNames.filter((name) => PLAN_MODE_READ_ONLY_TOOLS.has(name));
}

/** The plan extension supplies instructions; this lease enforces its read-only tool boundary. */
export function enterPlanMode(session: PlanModeSession): PlanModeLease {
  const toolsBeforePlanMode = session.getActiveToolNames();
  const activeTools = selectPlanModeTools(toolsBeforePlanMode);
  let active = true;
  session.setActiveToolsByName(activeTools);

  return {
    activeTools,
    restore() {
      if (!active) return;
      active = false;
      session.setActiveToolsByName(toolsBeforePlanMode);
    },
  };
}

export function beginActivePromptMode(
  promptRun: PromptRunIdentity,
  mode: Exclude<PromptMode, "normal">,
): ActivePromptMode {
  const state = { ...promptRun, mode };
  activePromptModes().set(promptRun.sessionId, state);
  return { ...state };
}

export function getActivePromptMode(sessionId: string): ActivePromptMode | undefined {
  const state = activePromptModes().get(sessionId);
  return state ? { ...state } : undefined;
}

export function finishActivePromptMode(promptRun: PromptRunIdentity): void {
  const current = activePromptModes().get(promptRun.sessionId);
  if (current?.runId === promptRun.runId) activePromptModes().delete(promptRun.sessionId);
}

export function resetActivePromptModesForTests(): void {
  activePromptModes().clear();
}

export interface GoalModeContinuationOptions {
  session: Pick<AgentSessionLike, "sessionId" | "prompt">;
  promptRun: PromptRunIdentity;
  onStateChange(state: GoalRunState): void;
  maxContinuations?: number;
}

export async function runGoalModeContinuations({
  session,
  promptRun,
  onStateChange,
  maxContinuations = GOAL_MODE_MAX_CONTINUATIONS,
}: GoalModeContinuationOptions): Promise<GoalRunState | undefined> {
  if (!Number.isInteger(maxContinuations) || maxContinuations < 0) {
    throw new Error("Target mode continuation limit must be a non-negative integer.");
  }

  while (getGoalRun(session.sessionId)?.status === "active") {
    const current = getGoalRun(session.sessionId)!;
    if (current.iteration >= maxContinuations) {
      const blocked = forceBlockGoal(
        promptRun,
        `Target mode reached its ${maxContinuations}-continuation safety limit. Review progress and start a new target-mode run to continue.`,
      );
      onStateChange(blocked);
      return blocked;
    }
    const advanced = advanceGoalIteration(promptRun);
    onStateChange(advanced);
    await session.prompt(GOAL_MODE_CONTINUATION, { source: "rpc" });
  }
  return getGoalRun(session.sessionId);
}
