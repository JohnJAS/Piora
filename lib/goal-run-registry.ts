import type { PromptRunIdentity, PromptToolIdentity } from "./prompt-run-registry";
import { getActivePromptRun, registerPromptRunCleanup } from "./prompt-run-registry";

export type GoalRunStatus = "active" | "complete" | "blocked";

export interface GoalRunState extends PromptRunIdentity {
  objective: string;
  status: GoalRunStatus;
  iteration: number;
  startedAt: number;
  updatedAt: number;
  progress?: string;
  summary?: string;
  reason?: string;
}

declare global {
  var __pioraGoalRuns: Map<string, GoalRunState> | undefined;
}

function runs(): Map<string, GoalRunState> {
  return globalThis.__pioraGoalRuns ??= new Map();
}

function copy(state: GoalRunState): GoalRunState {
  return { ...state };
}

export function beginGoalRun(identity: PromptRunIdentity, objective: string): GoalRunState {
  const activePrompt = getActivePromptRun(identity.sessionId);
  if (!activePrompt || activePrompt.runId !== identity.runId) throw new Error("Target mode requires an active prompt run.");
  const now = Date.now();
  const state: GoalRunState = {
    ...identity,
    objective: objective.trim().slice(0, 8_000),
    status: "active",
    iteration: 0,
    startedAt: now,
    updatedAt: now,
  };
  runs().set(identity.sessionId, state);
  registerPromptRunCleanup(identity, () => { runs().delete(identity.sessionId); });
  return copy(state);
}

export function getGoalRun(sessionId: string): GoalRunState | undefined {
  const state = runs().get(sessionId);
  return state ? copy(state) : undefined;
}

function requireGoal(identity: PromptToolIdentity | PromptRunIdentity): GoalRunState {
  const state = runs().get(identity.sessionId);
  if (!state || state.runId !== identity.runId) throw new Error("No active Piora target-mode run is attached to this tool call.");
  return state;
}

export function advanceGoalIteration(identity: PromptRunIdentity): GoalRunState {
  const state = requireGoal(identity);
  if (state.status !== "active") return copy(state);
  state.iteration += 1;
  state.updatedAt = Date.now();
  return copy(state);
}

export function updateGoalProgress(identity: PromptToolIdentity, progress: string): GoalRunState {
  const state = requireGoal(identity);
  if (state.status !== "active") throw new Error(`Target mode is already ${state.status}.`);
  state.progress = progress.trim().slice(0, 4_000);
  state.updatedAt = Date.now();
  return copy(state);
}

export function completeGoal(identity: PromptToolIdentity, summary: string): GoalRunState {
  const state = requireGoal(identity);
  if (state.status !== "active") throw new Error(`Target mode is already ${state.status}.`);
  state.status = "complete";
  state.summary = summary.trim().slice(0, 4_000);
  state.updatedAt = Date.now();
  return copy(state);
}

export function blockGoal(identity: PromptToolIdentity, reason: string): GoalRunState {
  const state = requireGoal(identity);
  if (state.status !== "active") throw new Error(`Target mode is already ${state.status}.`);
  state.status = "blocked";
  state.reason = reason.trim().slice(0, 4_000);
  state.updatedAt = Date.now();
  return copy(state);
}

export function forceBlockGoal(identity: PromptRunIdentity, reason: string): GoalRunState {
  const state = requireGoal(identity);
  if (state.status === "active") {
    state.status = "blocked";
    state.reason = reason.trim().slice(0, 4_000);
    state.updatedAt = Date.now();
  }
  return copy(state);
}

export function resetGoalRunRegistryForTests(): void {
  runs().clear();
}
