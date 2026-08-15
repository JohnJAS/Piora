import { randomUUID } from "node:crypto";

import type { PromptRunIdentity, PromptToolIdentity } from "./prompt-run-registry";
import { getActivePromptRun } from "./prompt-run-registry";

export const GOAL_RUN_ENTRY_TYPE = "piora-goal-run";
export const GOAL_RUN_SCHEMA_VERSION = 1;

export type GoalRunStatus = "active" | "paused" | "waiting_user" | "complete" | "blocked" | "cancelled";

export interface GoalCheckpoint {
  id: string;
  message: string;
  iteration: number;
  createdAt: number;
}

export interface GoalEvidence {
  id: string;
  summary: string;
  kind: "verification" | "artifact" | "observation";
  createdAt: number;
}

export interface GoalRunState extends PromptRunIdentity {
  schemaVersion: typeof GOAL_RUN_SCHEMA_VERSION;
  goalId: string;
  objective: string;
  successCriteria: string[];
  constraints: string[];
  status: GoalRunStatus;
  iteration: number;
  startedAt: number;
  updatedAt: number;
  checkpoints: GoalCheckpoint[];
  evidence: GoalEvidence[];
  progress?: string;
  summary?: string;
  reason?: string;
}

type GoalEntryLike = {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
};

declare global {
  var __pioraGoalRuns: Map<string, GoalRunState> | undefined;
}

function runs(): Map<string, GoalRunState> {
  return globalThis.__pioraGoalRuns ??= new Map();
}

function copy(state: GoalRunState): GoalRunState {
  return {
    ...state,
    successCriteria: [...state.successCriteria],
    constraints: [...state.constraints],
    checkpoints: state.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    evidence: state.evidence.map((item) => ({ ...item })),
  };
}

function cleanText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function isGoalRunState(value: unknown, sessionId: string): value is GoalRunState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GoalRunState>;
  return candidate.schemaVersion === GOAL_RUN_SCHEMA_VERSION
    && candidate.sessionId === sessionId
    && typeof candidate.goalId === "string"
    && typeof candidate.runId === "string"
    && typeof candidate.objective === "string"
    && typeof candidate.status === "string"
    && ["active", "paused", "waiting_user", "complete", "blocked", "cancelled"].includes(candidate.status)
    && typeof candidate.iteration === "number"
    && typeof candidate.startedAt === "number"
    && typeof candidate.updatedAt === "number"
    && Array.isArray(candidate.successCriteria)
    && Array.isArray(candidate.constraints)
    && Array.isArray(candidate.checkpoints)
    && Array.isArray(candidate.evidence);
}

export function parseGoalRunState(value: unknown, sessionId: string): GoalRunState | undefined {
  return isGoalRunState(value, sessionId) ? copy(value) : undefined;
}

export function beginGoalRun(identity: PromptRunIdentity, objective: string): GoalRunState {
  const activePrompt = getActivePromptRun(identity.sessionId);
  if (!activePrompt || activePrompt.runId !== identity.runId) throw new Error("Target mode requires an active prompt run.");

  const now = Date.now();
  const existing = runs().get(identity.sessionId);
  if (existing && (["paused", "waiting_user", "blocked", "active"] as GoalRunStatus[]).includes(existing.status)) {
    const guidance = cleanText(objective, 8_000);
    existing.runId = identity.runId;
    existing.status = "active";
    existing.updatedAt = now;
    existing.reason = undefined;
    if (guidance && guidance !== existing.objective) {
      existing.checkpoints.push({
        id: randomUUID(),
        message: `User continuation: ${guidance}`,
        iteration: existing.iteration,
        createdAt: now,
      });
      existing.progress = guidance;
    }
    return copy(existing);
  }

  const state: GoalRunState = {
    ...identity,
    schemaVersion: GOAL_RUN_SCHEMA_VERSION,
    goalId: randomUUID(),
    objective: cleanText(objective, 8_000),
    successCriteria: ["The requested outcome is fully satisfied and verified against current workspace evidence."],
    constraints: [],
    status: "active",
    iteration: 0,
    startedAt: now,
    updatedAt: now,
    checkpoints: [],
    evidence: [],
  };
  runs().set(identity.sessionId, state);
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
  const message = cleanText(progress, 4_000);
  if (!message) throw new Error("A progress checkpoint requires a non-empty message.");
  const now = Date.now();
  state.progress = message;
  state.checkpoints.push({ id: randomUUID(), message, iteration: state.iteration, createdAt: now });
  state.updatedAt = now;
  return copy(state);
}

export function addGoalEvidence(
  identity: PromptToolIdentity,
  summary: string,
  kind: GoalEvidence["kind"] = "verification",
): GoalRunState {
  const state = requireGoal(identity);
  if (state.status !== "active") throw new Error(`Target mode is already ${state.status}.`);
  const cleaned = cleanText(summary, 4_000);
  if (!cleaned) throw new Error("Goal evidence requires a non-empty summary.");
  const now = Date.now();
  state.evidence.push({ id: randomUUID(), summary: cleaned, kind, createdAt: now });
  state.updatedAt = now;
  return copy(state);
}

export function completeGoal(identity: PromptToolIdentity, summary: string): GoalRunState {
  const state = requireGoal(identity);
  if (state.status !== "active") throw new Error(`Target mode is already ${state.status}.`);
  if (state.evidence.length === 0) throw new Error("Target mode requires concrete verification evidence before completion.");
  const cleaned = cleanText(summary, 4_000);
  if (!cleaned) throw new Error("Goal completion requires a non-empty summary.");
  state.status = "complete";
  state.summary = cleaned;
  state.updatedAt = Date.now();
  return copy(state);
}

export function blockGoal(identity: PromptToolIdentity, reason: string): GoalRunState {
  const state = requireGoal(identity);
  if (state.status !== "active") throw new Error(`Target mode is already ${state.status}.`);
  const cleaned = cleanText(reason, 4_000);
  if (!cleaned) throw new Error("A blocked goal requires the exact unblock condition.");
  state.status = "blocked";
  state.reason = cleaned;
  state.updatedAt = Date.now();
  return copy(state);
}

export function waitGoalForUser(identity: PromptToolIdentity, reason: string): GoalRunState {
  const state = requireGoal(identity);
  if (state.status !== "active") throw new Error(`Target mode is already ${state.status}.`);
  const cleaned = cleanText(reason, 4_000);
  if (!cleaned) throw new Error("A goal waiting for the user requires the exact question or decision needed.");
  state.status = "waiting_user";
  state.reason = cleaned;
  state.updatedAt = Date.now();
  return copy(state);
}

export function pauseGoalRun(sessionId: string, reason = "Target mode was paused by the user."): GoalRunState {
  const state = runs().get(sessionId);
  if (!state) throw new Error("No Piora target-mode goal exists for this session.");
  if (state.status === "complete" || state.status === "cancelled") throw new Error(`Target mode is already ${state.status}.`);
  state.status = "paused";
  state.reason = cleanText(reason, 4_000);
  state.updatedAt = Date.now();
  return copy(state);
}

export function prepareGoalResume(sessionId: string): GoalRunState {
  const state = runs().get(sessionId);
  if (!state) throw new Error("No Piora target-mode goal exists for this session.");
  if (state.status !== "paused" && state.status !== "waiting_user" && state.status !== "blocked") {
    throw new Error(`Only a paused, waiting, or blocked goal can resume; target mode is ${state.status}.`);
  }
  state.status = "paused";
  state.reason = "Resume requested. Send the next message with Target Mode enabled to continue this goal.";
  state.updatedAt = Date.now();
  return copy(state);
}

export function cancelGoalRun(sessionId: string, reason = "Target mode was cancelled by the user."): GoalRunState {
  const state = runs().get(sessionId);
  if (!state) throw new Error("No Piora target-mode goal exists for this session.");
  if (state.status === "complete") throw new Error("A completed goal cannot be cancelled.");
  state.status = "cancelled";
  state.reason = cleanText(reason, 4_000);
  state.updatedAt = Date.now();
  return copy(state);
}

export function forceBlockGoal(identity: PromptRunIdentity, reason: string): GoalRunState {
  const state = requireGoal(identity);
  if (state.status === "active") {
    state.status = "blocked";
    state.reason = cleanText(reason, 4_000);
    state.updatedAt = Date.now();
  }
  return copy(state);
}

export function restoreGoalRunFromEntries(sessionId: string, entries: readonly GoalEntryLike[]): GoalRunState | undefined {
  let restored: GoalRunState | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== GOAL_RUN_ENTRY_TYPE) continue;
    if (isGoalRunState(entry.data, sessionId)) restored = copy(entry.data);
  }
  if (!restored) {
    runs().delete(sessionId);
    return undefined;
  }
  if (restored.status === "active") {
    restored.status = "paused";
    restored.reason = "Target mode was restored after its previous runtime ended. Send another target-mode message to continue.";
    restored.updatedAt = Date.now();
  }
  runs().set(sessionId, restored);
  return copy(restored);
}

export function forgetGoalRun(sessionId: string): void {
  runs().delete(sessionId);
}

export function resetGoalRunRegistryForTests(): void {
  runs().clear();
}
