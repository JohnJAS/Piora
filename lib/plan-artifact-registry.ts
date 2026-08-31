import { randomUUID } from "node:crypto";

import type { PromptRunIdentity, PromptToolIdentity } from "./prompt-run-registry";
import { getActivePromptRun } from "./prompt-run-registry";
import type { GitStatusResponse } from "./git-types";
import { runtimeToolArgument, runtimeToolResultText, runtimeVerificationLabel } from "./runtime-evidence";
import {
  TASK_PLAN_SCHEMA_VERSION,
  type TaskPlanArtifact,
  type TaskPlanStep,
} from "./task-run";

export const PLAN_ARTIFACT_ENTRY_TYPE = "piora-plan-artifact";
export const PLAN_ARTIFACT_SCHEMA_VERSION = 1;

export type PlanArtifactStatus = "draft" | "approved" | "cancelled";

export type PlanExecutionStatus =
  | "running"
  | "verifying"
  | "waiting_user"
  | "blocked"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled";

export interface PlanExecutionEvidence {
  id: string;
  stepId?: string;
  kind: "verification" | "artifact" | "observation";
  summary: string;
  successCriterionIndices: number[];
  createdAt: number;
  source: "model" | "runtime";
  toolName?: string;
  toolCallId?: string;
}

export interface PlanExecutionArtifact {
  id: string;
  stepId?: string;
  kind: "patch" | "commit" | "report" | "file";
  name: string;
  summary?: string;
  createdAt: number;
  source: "model" | "runtime";
  toolName?: string;
  toolCallId?: string;
}

export interface PlanExecutionState {
  executionId: string;
  runId: string;
  status: PlanExecutionStatus;
  attempt: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  currentStepId?: string;
  progress?: string;
  summary?: string;
  reason?: string;
  changeSummary?: string;
  evidence: PlanExecutionEvidence[];
  artifacts: PlanExecutionArtifact[];
}

export interface PlanDraftStepInput {
  id: string;
  title: string;
  description?: string;
  dependsOn?: string[];
}

export interface PlanDraftInput {
  objective: string;
  assumptions?: string[];
  successCriteria: string[];
  steps: PlanDraftStepInput[];
}

export interface PlanArtifactState extends PromptRunIdentity {
  schemaVersion: typeof PLAN_ARTIFACT_SCHEMA_VERSION;
  status: PlanArtifactStatus;
  revision: number;
  plan: TaskPlanArtifact;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
  cancelledAt?: number;
  execution?: PlanExecutionState;
}

type PlanEntryLike = {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
};

declare global {
  var __pioraPlanArtifacts: Map<string, PlanArtifactState> | undefined;
}

function artifacts(): Map<string, PlanArtifactState> {
  return globalThis.__pioraPlanArtifacts ??= new Map();
}

function cleanText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function requireText(value: unknown, label: string, maxLength: number): string {
  const cleaned = typeof value === "string" ? cleanText(value, maxLength) : "";
  if (!cleaned) throw new Error(`${label} requires non-empty text.`);
  return cleaned;
}

function normalizeTextList(value: unknown, label: string, maxItems: number): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > maxItems) throw new Error(`${label} supports at most ${maxItems} items.`);
  return value.map((item, index) => requireText(item, `${label} item ${index + 1}`, 2_000));
}

function normalizeStepId(value: unknown, index: number): string {
  const id = requireText(value, `Plan step ${index + 1} id`, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(`Plan step ${index + 1} id may contain only letters, numbers, dots, underscores, and hyphens.`);
  }
  return id;
}

function assertAcyclic(steps: readonly TaskPlanStep[]): void {
  const dependencies = new Map(steps.map((step) => [step.id, step.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Plan steps contain a dependency cycle involving ${id}.`);
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };

  for (const step of steps) visit(step.id);
}

function normalizePlanInput(
  input: PlanDraftInput,
  identity: { planId: string; createdAt: number; updatedAt: number },
): TaskPlanArtifact {
  if (!input || typeof input !== "object") throw new Error("Plan input is required.");
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error("A plan requires at least one step.");
  }
  if (input.steps.length > 64) throw new Error("A plan supports at most 64 steps.");

  const ids = new Set<string>();
  const steps = input.steps.map((step, index): TaskPlanStep => {
    if (!step || typeof step !== "object") throw new Error(`Plan step ${index + 1} is invalid.`);
    const id = normalizeStepId(step.id, index);
    if (ids.has(id)) throw new Error(`Plan step id ${id} is duplicated.`);
    ids.add(id);
    const dependsOn = Array.isArray(step.dependsOn)
      ? step.dependsOn.map((dependency, dependencyIndex) => (
          requireText(dependency, `Dependency ${dependencyIndex + 1} for step ${id}`, 64)
        ))
      : [];
    if (new Set(dependsOn).size !== dependsOn.length) {
      throw new Error(`Plan step ${id} contains duplicate dependencies.`);
    }
    return {
      id,
      title: requireText(step.title, `Plan step ${index + 1} title`, 500),
      ...(step.description
        ? { description: requireText(step.description, `Plan step ${index + 1} description`, 4_000) }
        : {}),
      dependsOn,
      status: "pending",
    };
  });

  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Plan step ${step.id} depends on unknown step ${dependency}.`);
      if (dependency === step.id) throw new Error(`Plan step ${step.id} cannot depend on itself.`);
    }
  }
  assertAcyclic(steps);

  const successCriteria = normalizeTextList(input.successCriteria, "Success criteria", 32);
  if (successCriteria.length === 0) throw new Error("A plan requires at least one success criterion.");

  return {
    schemaVersion: TASK_PLAN_SCHEMA_VERSION,
    id: identity.planId,
    objective: requireText(input.objective, "Plan objective", 8_000),
    assumptions: normalizeTextList(input.assumptions ?? [], "Assumptions", 32),
    successCriteria,
    steps,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  };
}

function copy(state: PlanArtifactState): PlanArtifactState {
  return {
    ...state,
    ...(state.execution ? {
      execution: {
        ...state.execution,
        evidence: (state.execution.evidence ?? []).map((item) => ({
          ...item,
          source: item.source ?? "model",
          successCriterionIndices: [...item.successCriterionIndices],
        })),
        artifacts: (state.execution.artifacts ?? []).map((item) => ({
          ...item,
          source: item.source ?? "model",
        })),
      },
    } : {}),
    plan: {
      ...state.plan,
      assumptions: [...state.plan.assumptions],
      successCriteria: [...state.plan.successCriteria],
      steps: state.plan.steps.map((step) => ({ ...step, dependsOn: [...step.dependsOn] })),
    },
  };
}

function isPlanStep(value: unknown): value is TaskPlanStep {
  if (!value || typeof value !== "object") return false;
  const step = value as Partial<TaskPlanStep>;
  return typeof step.id === "string"
    && typeof step.title === "string"
    && (step.description === undefined || typeof step.description === "string")
    && Array.isArray(step.dependsOn)
    && step.dependsOn.every((dependency) => typeof dependency === "string")
    && ["pending", "running", "completed", "blocked", "skipped"].includes(String(step.status))
    && (step.result === undefined || typeof step.result === "string")
    && (step.reason === undefined || typeof step.reason === "string")
    && (step.startedAt === undefined || typeof step.startedAt === "number")
    && (step.finishedAt === undefined || typeof step.finishedAt === "number");
}

function isPlanExecution(value: unknown): value is PlanExecutionState {
  if (!value || typeof value !== "object") return false;
  const execution = value as Partial<PlanExecutionState>;
  return typeof execution.executionId === "string"
    && typeof execution.runId === "string"
    && ["running", "verifying", "waiting_user", "blocked", "completed", "failed", "interrupted", "cancelled"].includes(String(execution.status))
    && typeof execution.attempt === "number"
    && Number.isInteger(execution.attempt)
    && execution.attempt > 0
    && typeof execution.startedAt === "number"
    && typeof execution.updatedAt === "number"
    && (execution.finishedAt === undefined || typeof execution.finishedAt === "number")
    && (execution.currentStepId === undefined || typeof execution.currentStepId === "string")
    && (execution.progress === undefined || typeof execution.progress === "string")
    && (execution.summary === undefined || typeof execution.summary === "string")
    && (execution.reason === undefined || typeof execution.reason === "string")
    && (execution.changeSummary === undefined || typeof execution.changeSummary === "string")
    && (execution.evidence === undefined || (
      Array.isArray(execution.evidence) && execution.evidence.every(isPlanExecutionEvidence)
    ))
    && (execution.artifacts === undefined || (
      Array.isArray(execution.artifacts) && execution.artifacts.every(isPlanExecutionArtifact)
    ));
}

function isPlanExecutionEvidence(value: unknown): value is PlanExecutionEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as Partial<PlanExecutionEvidence>;
  return typeof evidence.id === "string"
    && (evidence.stepId === undefined || typeof evidence.stepId === "string")
    && ["verification", "artifact", "observation"].includes(String(evidence.kind))
    && typeof evidence.summary === "string"
    && Array.isArray(evidence.successCriterionIndices)
    && evidence.successCriterionIndices.every((index) => Number.isInteger(index) && index >= 0)
    && typeof evidence.createdAt === "number"
    && (evidence.source === undefined || evidence.source === "model" || evidence.source === "runtime")
    && (evidence.toolName === undefined || typeof evidence.toolName === "string")
    && (evidence.toolCallId === undefined || typeof evidence.toolCallId === "string");
}

function isPlanExecutionArtifact(value: unknown): value is PlanExecutionArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Partial<PlanExecutionArtifact>;
  return typeof artifact.id === "string"
    && (artifact.stepId === undefined || typeof artifact.stepId === "string")
    && ["patch", "commit", "report", "file"].includes(String(artifact.kind))
    && typeof artifact.name === "string"
    && (artifact.summary === undefined || typeof artifact.summary === "string")
    && typeof artifact.createdAt === "number"
    && (artifact.source === undefined || artifact.source === "model" || artifact.source === "runtime")
    && (artifact.toolName === undefined || typeof artifact.toolName === "string")
    && (artifact.toolCallId === undefined || typeof artifact.toolCallId === "string");
}

function isPlanArtifactState(value: unknown, sessionId: string): value is PlanArtifactState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<PlanArtifactState>;
  const plan = state.plan as Partial<TaskPlanArtifact> | undefined;
  return state.schemaVersion === PLAN_ARTIFACT_SCHEMA_VERSION
    && state.sessionId === sessionId
    && typeof state.runId === "string"
    && ["draft", "approved", "cancelled"].includes(String(state.status))
    && typeof state.revision === "number"
    && Number.isInteger(state.revision)
    && state.revision > 0
    && typeof state.createdAt === "number"
    && typeof state.updatedAt === "number"
    && plan?.schemaVersion === TASK_PLAN_SCHEMA_VERSION
    && typeof plan.id === "string"
    && typeof plan.objective === "string"
    && Array.isArray(plan.assumptions)
    && plan.assumptions.every((item) => typeof item === "string")
    && Array.isArray(plan.successCriteria)
    && plan.successCriteria.every((item) => typeof item === "string")
    && Array.isArray(plan.steps)
    && plan.steps.every(isPlanStep)
    && typeof plan.createdAt === "number"
    && typeof plan.updatedAt === "number"
    && (state.execution === undefined || isPlanExecution(state.execution));
}

function requireCurrentPlan(sessionId: string): PlanArtifactState {
  const state = artifacts().get(sessionId);
  if (!state) throw new Error("No structured plan exists for this session.");
  return state;
}

function requireExecution(identity: PromptToolIdentity | PromptRunIdentity): PlanArtifactState {
  const state = requireCurrentPlan(identity.sessionId);
  const activePrompt = getActivePromptRun(identity.sessionId);
  if (!activePrompt || activePrompt.runId !== identity.runId) {
    throw new Error("Plan execution requires an active prompt run.");
  }
  if (!state.execution || state.execution.runId !== identity.runId) {
    throw new Error("No active plan execution is attached to this prompt run.");
  }
  if (state.execution.status !== "running" && state.execution.status !== "verifying") {
    throw new Error(`Plan execution is already ${state.execution.status}.`);
  }
  return state;
}

function touchExecution(state: PlanArtifactState, now = Date.now()): void {
  state.revision += 1;
  state.updatedAt = now;
  state.plan.updatedAt = now;
  if (state.execution) state.execution.updatedAt = now;
}

export function parsePlanArtifactState(value: unknown, sessionId: string): PlanArtifactState | undefined {
  return isPlanArtifactState(value, sessionId) ? copy(value) : undefined;
}

function requireDraft(sessionId: string, expectedRevision: number): PlanArtifactState {
  const state = artifacts().get(sessionId);
  if (!state) throw new Error("No structured plan exists for this session.");
  if (state.status !== "draft") throw new Error(`The plan is already ${state.status}.`);
  if (state.revision !== expectedRevision) {
    throw new Error(`The plan changed from revision ${expectedRevision} to ${state.revision}. Reload it before continuing.`);
  }
  return state;
}

export function submitPlanArtifact(identity: PromptToolIdentity, input: PlanDraftInput): PlanArtifactState {
  const activePrompt = getActivePromptRun(identity.sessionId);
  if (!activePrompt || activePrompt.runId !== identity.runId) {
    throw new Error("Plan submission requires an active prompt run.");
  }

  const now = Date.now();
  const existing = artifacts().get(identity.sessionId);
  const sameRunDraft = existing?.runId === identity.runId && existing.status === "draft";
  const planId = sameRunDraft ? existing.plan.id : randomUUID();
  const createdAt = sameRunDraft ? existing.createdAt : now;
  const revision = sameRunDraft ? existing.revision + 1 : 1;
  const state: PlanArtifactState = {
    ...identity,
    schemaVersion: PLAN_ARTIFACT_SCHEMA_VERSION,
    status: "draft",
    revision,
    plan: normalizePlanInput(input, { planId, createdAt, updatedAt: now }),
    createdAt,
    updatedAt: now,
  };
  artifacts().set(identity.sessionId, state);
  return copy(state);
}

export function getPlanArtifact(sessionId: string): PlanArtifactState | undefined {
  const state = artifacts().get(sessionId);
  return state ? copy(state) : undefined;
}

export function updatePlanArtifact(
  sessionId: string,
  expectedRevision: number,
  input: PlanDraftInput,
): PlanArtifactState {
  const state = requireDraft(sessionId, expectedRevision);
  const now = Date.now();
  state.plan = normalizePlanInput(input, {
    planId: state.plan.id,
    createdAt: state.plan.createdAt,
    updatedAt: now,
  });
  state.revision += 1;
  state.updatedAt = now;
  return copy(state);
}

export function approvePlanArtifact(sessionId: string, expectedRevision: number): PlanArtifactState {
  const state = requireDraft(sessionId, expectedRevision);
  const now = Date.now();
  state.status = "approved";
  state.revision += 1;
  state.updatedAt = now;
  state.approvedAt = now;
  return copy(state);
}

export function cancelPlanArtifact(sessionId: string, expectedRevision: number): PlanArtifactState {
  const state = artifacts().get(sessionId);
  if (!state) throw new Error("No structured plan exists for this session.");
  if (state.status === "cancelled") throw new Error("The plan is already cancelled.");
  if (state.revision !== expectedRevision) {
    throw new Error(`The plan changed from revision ${expectedRevision} to ${state.revision}. Reload it before continuing.`);
  }
  const now = Date.now();
  state.status = "cancelled";
  state.revision += 1;
  state.updatedAt = now;
  state.cancelledAt = now;
  return copy(state);
}

export function beginPlanExecution(
  identity: PromptRunIdentity,
  planId: string,
  expectedRevision: number,
): PlanArtifactState {
  const activePrompt = getActivePromptRun(identity.sessionId);
  if (!activePrompt || activePrompt.runId !== identity.runId) {
    throw new Error("Plan execution requires an active prompt run.");
  }
  const state = requireCurrentPlan(identity.sessionId);
  if (state.plan.id !== planId) throw new Error("The approved plan no longer matches this execution request.");
  if (state.revision !== expectedRevision) {
    throw new Error(`The plan changed from revision ${expectedRevision} to ${state.revision}. Reload it before executing.`);
  }
  if (state.status !== "approved") throw new Error("Only an approved plan can be executed.");
  if (state.execution && !["blocked", "failed", "interrupted", "cancelled", "waiting_user"].includes(state.execution.status)) {
    throw new Error(`Plan execution is already ${state.execution.status}.`);
  }

  const now = Date.now();
  const priorAttempt = state.execution?.attempt ?? 0;
  state.plan.steps = state.plan.steps.map((step) => ({
    id: step.id,
    title: step.title,
    ...(step.description ? { description: step.description } : {}),
    dependsOn: [...step.dependsOn],
    status: "pending",
  }));
  state.execution = {
    executionId: state.execution?.executionId ?? randomUUID(),
    runId: identity.runId,
    status: "running",
    attempt: priorAttempt + 1,
    startedAt: now,
    updatedAt: now,
    progress: "Execution started from the approved plan.",
    evidence: [],
    artifacts: [],
  };
  touchExecution(state, now);
  return copy(state);
}

export function resumePlanExecution(identity: PromptRunIdentity): PlanArtifactState {
  const state = requireCurrentPlan(identity.sessionId);
  const execution = state.execution;
  if (!execution || !["blocked", "failed", "interrupted", "waiting_user"].includes(execution.status)) {
    throw new Error("No paused plan execution is available to resume.");
  }
  const activePrompt = getActivePromptRun(identity.sessionId);
  if (!activePrompt || activePrompt.runId !== identity.runId) {
    throw new Error("Plan execution resume requires an active prompt run.");
  }
  const now = Date.now();
  execution.runId = identity.runId;
  execution.status = "running";
  execution.attempt += 1;
  execution.updatedAt = now;
  execution.finishedAt = undefined;
  execution.reason = undefined;
  execution.progress = "Execution resumed.";
  for (const step of state.plan.steps) {
    if (step.status === "blocked" || step.status === "running") {
      step.status = "pending";
      step.reason = undefined;
      step.startedAt = undefined;
      step.finishedAt = undefined;
    }
  }
  execution.currentStepId = undefined;
  touchExecution(state, now);
  return copy(state);
}

export function interruptPlanExecution(
  sessionId: string,
  runId: string,
  reason = "Plan execution paused when the extension turn ended.",
): PlanArtifactState | undefined {
  const state = artifacts().get(sessionId);
  const execution = state?.execution;
  if (!state || !execution || execution.runId !== runId) return state ? copy(state) : undefined;
  if (execution.status !== "running" && execution.status !== "verifying") return copy(state);
  const now = Date.now();
  execution.status = "interrupted";
  execution.reason = cleanText(reason, 4_000);
  execution.finishedAt = now;
  touchExecution(state, now);
  return copy(state);
}

export function startPlanStep(identity: PromptToolIdentity, stepId: string): PlanArtifactState {
  const state = requireExecution(identity);
  if (state.execution!.status !== "running") throw new Error("Cannot start another step during verification.");
  const step = state.plan.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Unknown plan step ${stepId}.`);
  if (step.status !== "pending") throw new Error(`Plan step ${stepId} is already ${step.status}.`);
  const activeStep = state.plan.steps.find((candidate) => candidate.status === "running");
  if (activeStep) throw new Error(`Plan step ${activeStep.id} is already running.`);
  const unmet = step.dependsOn.filter((dependency) => {
    const dependencyStep = state.plan.steps.find((candidate) => candidate.id === dependency);
    return dependencyStep?.status !== "completed" && dependencyStep?.status !== "skipped";
  });
  if (unmet.length > 0) throw new Error(`Plan step ${stepId} has unmet dependencies: ${unmet.join(", ")}.`);
  const now = Date.now();
  step.status = "running";
  step.startedAt = now;
  step.finishedAt = undefined;
  step.reason = undefined;
  state.execution!.currentStepId = step.id;
  state.execution!.progress = `Running ${step.title}`;
  touchExecution(state, now);
  return copy(state);
}

export function completePlanStep(
  identity: PromptToolIdentity,
  stepId: string,
  result: string,
): PlanArtifactState {
  const state = requireExecution(identity);
  const step = state.plan.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Unknown plan step ${stepId}.`);
  if (step.status !== "running") throw new Error(`Plan step ${stepId} must be running before completion.`);
  if (!state.execution!.evidence.some((item) => item.stepId === stepId)) {
    throw new Error(`Plan step ${stepId} requires concrete evidence before completion.`);
  }
  const now = Date.now();
  step.status = "completed";
  step.result = requireText(result, "Plan step result", 4_000);
  step.finishedAt = now;
  state.execution!.currentStepId = undefined;
  state.execution!.progress = `Completed ${step.title}`;
  touchExecution(state, now);
  return copy(state);
}

export function skipPlanStep(
  identity: PromptToolIdentity,
  stepId: string,
  reason: string,
): PlanArtifactState {
  const state = requireExecution(identity);
  const step = state.plan.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Unknown plan step ${stepId}.`);
  if (step.status !== "pending") throw new Error(`Only a pending plan step can be skipped; ${stepId} is ${step.status}.`);
  const now = Date.now();
  step.status = "skipped";
  step.reason = requireText(reason, "Skipped step reason", 4_000);
  step.finishedAt = now;
  state.execution!.progress = `Skipped ${step.title}`;
  touchExecution(state, now);
  return copy(state);
}

export function blockPlanStep(
  identity: PromptToolIdentity,
  stepId: string,
  reason: string,
): PlanArtifactState {
  const state = requireExecution(identity);
  const step = state.plan.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`Unknown plan step ${stepId}.`);
  if (step.status !== "running" && step.status !== "pending") {
    throw new Error(`Plan step ${stepId} cannot be blocked while ${step.status}.`);
  }
  const now = Date.now();
  const cleaned = requireText(reason, "Blocked step reason", 4_000);
  step.status = "blocked";
  step.reason = cleaned;
  step.finishedAt = now;
  state.execution!.status = "blocked";
  state.execution!.currentStepId = step.id;
  state.execution!.reason = cleaned;
  state.execution!.finishedAt = now;
  touchExecution(state, now);
  return copy(state);
}

export function beginPlanVerification(identity: PromptToolIdentity): PlanArtifactState {
  const state = requireExecution(identity);
  if (state.execution!.status !== "running") throw new Error("Plan execution is already verifying.");
  const unfinished = state.plan.steps.filter((step) => step.status !== "completed" && step.status !== "skipped");
  if (unfinished.length > 0) {
    throw new Error(`Complete or skip every plan step before verification: ${unfinished.map((step) => step.id).join(", ")}.`);
  }
  const now = Date.now();
  state.execution!.status = "verifying";
  state.execution!.currentStepId = undefined;
  state.execution!.progress = "Verifying the approved plan's success criteria.";
  touchExecution(state, now);
  return copy(state);
}

export function addPlanExecutionEvidence(
  identity: PromptToolIdentity,
  summary: string,
  kind: PlanExecutionEvidence["kind"] = "verification",
  stepId?: string,
  successCriterionIndices: number[] = [],
): PlanArtifactState {
  const state = requireExecution(identity);
  const cleaned = requireText(summary, "Plan execution evidence", 4_000);
  const normalizedStepId = stepId?.trim() || undefined;
  if (normalizedStepId) {
    const step = state.plan.steps.find((candidate) => candidate.id === normalizedStepId);
    if (!step) throw new Error(`Unknown plan step ${normalizedStepId}.`);
    if (step.status !== "running" && step.status !== "completed") {
      throw new Error(`Evidence for plan step ${normalizedStepId} requires a running or completed step.`);
    }
  }
  if (!Array.isArray(successCriterionIndices)) throw new Error("Success criterion indices must be a list.");
  const indices = [...new Set(successCriterionIndices)];
  if (indices.length !== successCriterionIndices.length) {
    throw new Error("Success criterion indices must not contain duplicates.");
  }
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= state.plan.successCriteria.length) {
      throw new Error(`Unknown success criterion index ${String(index)}.`);
    }
  }
  if (indices.length > 0 && kind !== "verification") {
    throw new Error("Only verification evidence can cover success criteria.");
  }
  const now = Date.now();
  state.execution!.evidence.push({
    id: randomUUID(),
    ...(normalizedStepId ? { stepId: normalizedStepId } : {}),
    kind,
    summary: cleaned,
    successCriterionIndices: indices,
    createdAt: now,
    source: "model",
  });
  state.execution!.progress = normalizedStepId
    ? `Recorded evidence for ${normalizedStepId}.`
    : "Recorded execution evidence.";
  touchExecution(state, now);
  return copy(state);
}

export function addPlanExecutionArtifact(
  identity: PromptToolIdentity,
  name: string,
  kind: PlanExecutionArtifact["kind"],
  summary?: string,
  stepId?: string,
): PlanArtifactState {
  const state = requireExecution(identity);
  const cleanedName = requireText(name, "Plan execution artifact name", 500);
  const normalizedStepId = stepId?.trim() || undefined;
  if (normalizedStepId) {
    const step = state.plan.steps.find((candidate) => candidate.id === normalizedStepId);
    if (!step) throw new Error(`Unknown plan step ${normalizedStepId}.`);
    if (step.status !== "running" && step.status !== "completed") {
      throw new Error(`An artifact for plan step ${normalizedStepId} requires a running or completed step.`);
    }
  }
  const now = Date.now();
  state.execution!.artifacts.push({
    id: randomUUID(),
    ...(normalizedStepId ? { stepId: normalizedStepId } : {}),
    kind,
    name: cleanedName,
    ...(summary ? { summary: requireText(summary, "Plan execution artifact summary", 4_000) } : {}),
    createdAt: now,
    source: "model",
  });
  state.execution!.progress = normalizedStepId
    ? `Recorded artifact for ${normalizedStepId}.`
    : "Recorded an execution artifact.";
  touchExecution(state, now);
  return copy(state);
}

export function recordPlanChangeSummary(identity: PromptToolIdentity, summary: string): PlanArtifactState {
  const state = requireExecution(identity);
  const now = Date.now();
  state.execution!.changeSummary = requireText(summary, "Plan change summary", 8_000);
  state.execution!.progress = "Recorded the final change summary.";
  touchExecution(state, now);
  return copy(state);
}

export function capturePlanRuntimeToolResult(
  identity: PromptRunIdentity,
  toolCallId: string,
  toolName: string,
  args: unknown,
  isError: boolean,
  result?: unknown,
): PlanArtifactState | undefined {
  const state = artifacts().get(identity.sessionId);
  const execution = state?.execution;
  if (!state || !execution || execution.runId !== identity.runId || isError) return state ? copy(state) : undefined;
  if (execution.status !== "running" && execution.status !== "verifying") return copy(state);
  if (execution.evidence.some((item) => item.toolCallId === toolCallId)
    || execution.artifacts.some((item) => item.toolCallId === toolCallId)) {
    return copy(state);
  }

  const stepId = execution.currentStepId;
  const now = Date.now();
  if (toolName === "bash") {
    const command = runtimeToolArgument(args, ["command"]);
    if (!command) return copy(state);
    const verificationLabel = runtimeVerificationLabel(command);
    execution.evidence.push({
      id: randomUUID(),
      ...(stepId ? { stepId } : {}),
      kind: verificationLabel ? "verification" : "observation",
      summary: verificationLabel
        ? `Runtime confirmed the ${verificationLabel} completed successfully.`
        : "Runtime confirmed a shell command completed successfully.",
      successCriterionIndices: [],
      createdAt: now,
      source: "runtime",
      toolName,
      toolCallId,
    });
    if (/(?:^|\s)git\s+commit(?:\s|$)/i.test(command)) {
      const commitId = runtimeToolResultText(result).match(/\[[^\]]+\s+([0-9a-f]{7,40})\]/i)?.[1];
      execution.artifacts.push({
        id: randomUUID(),
        ...(stepId ? { stepId } : {}),
        kind: "commit",
        name: commitId ? `Git commit ${commitId}` : "Git commit",
        summary: "Runtime confirmed that the Git commit command completed successfully.",
        createdAt: now,
        source: "runtime",
        toolName,
        toolCallId,
      });
    }
  } else if (toolName === "edit" || toolName === "write") {
    const fileName = runtimeToolArgument(args, ["path", "filePath", "file_path"]);
    if (!fileName) return copy(state);
    execution.artifacts.push({
      id: randomUUID(),
      ...(stepId ? { stepId } : {}),
      kind: "file",
      name: fileName,
      summary: `File mutation completed through the ${toolName} tool.`,
      createdAt: now,
      source: "runtime",
      toolName,
      toolCallId,
    });
    execution.evidence.push({
      id: randomUUID(),
      ...(stepId ? { stepId } : {}),
      kind: "observation",
      summary: `Runtime confirmed a successful ${toolName} operation for ${fileName}.`,
      successCriterionIndices: [],
      createdAt: now,
      source: "runtime",
      toolName,
      toolCallId,
    });
  } else {
    return copy(state);
  }
  execution.progress = `Captured runtime evidence from ${toolName}.`;
  touchExecution(state, now);
  return copy(state);
}

export function capturePlanGitSnapshot(
  identity: PromptToolIdentity,
  status: GitStatusResponse,
): PlanArtifactState {
  const state = requireExecution(identity);
  if (state.execution!.status !== "verifying") {
    throw new Error("Git change capture is available only during plan verification.");
  }
  const now = Date.now();
  const snapshotId = `git-status:${identity.toolCallId}`;
  if (state.execution!.evidence.some((item) => item.toolCallId === snapshotId)) return copy(state);
  const summary = status.isGitRepository
    ? `Runtime Git snapshot: ${status.files.length} changed files, +${status.additions}/-${status.deletions}${status.branch ? ` on ${status.branch}` : ""}.`
    : "Runtime Git snapshot: the execution workspace is not a Git repository.";
  state.execution!.evidence.push({
    id: randomUUID(),
    kind: "observation",
    summary,
    successCriterionIndices: [],
    createdAt: now,
    source: "runtime",
    toolName: "git_status",
    toolCallId: snapshotId,
  });
  for (const file of status.files.slice(0, 256)) {
    if (state.execution!.artifacts.some((item) => item.source === "runtime" && item.name === file.filePath)) continue;
    state.execution!.artifacts.push({
      id: randomUUID(),
      kind: "file",
      name: file.filePath,
      summary: `${file.status}${file.additions || file.deletions ? ` (+${file.additions ?? 0}/-${file.deletions ?? 0})` : ""}`,
      createdAt: now,
      source: "runtime",
      toolName: "git_status",
      toolCallId: snapshotId,
    });
  }
  state.execution!.progress = "Captured a runtime Git change snapshot.";
  touchExecution(state, now);
  return copy(state);
}

export function completePlanExecution(identity: PromptToolIdentity, summary: string): PlanArtifactState {
  const state = requireExecution(identity);
  if (state.execution!.status !== "verifying") {
    throw new Error("Plan execution must enter verification before completion.");
  }
  if (!state.execution!.changeSummary) {
    throw new Error("Plan execution requires a change summary before completion.");
  }
  if (!state.execution!.evidence.some((item) => item.source === "runtime" && item.kind === "verification")) {
    throw new Error("Plan execution requires at least one successful runtime-captured verification command before completion.");
  }
  const coveredCriteria = new Set(
    state.execution!.evidence
      .filter((item) => item.kind === "verification")
      .flatMap((item) => item.successCriterionIndices),
  );
  const uncoveredCriteria = state.plan.successCriteria
    .map((_criterion, index) => index)
    .filter((index) => !coveredCriteria.has(index));
  if (uncoveredCriteria.length > 0) {
    throw new Error(`Plan execution requires verification evidence for success criteria: ${uncoveredCriteria.join(", ")}.`);
  }
  const now = Date.now();
  const cleaned = requireText(summary, "Plan execution summary", 4_000);
  state.execution!.status = "completed";
  state.execution!.summary = cleaned;
  state.execution!.progress = cleaned;
  state.execution!.finishedAt = now;
  touchExecution(state, now);
  return copy(state);
}

export function settlePlanExecutionFromGoal(
  sessionId: string,
  runId: string,
  goalStatus: "active" | "paused" | "waiting_user" | "complete" | "blocked" | "cancelled",
  reason?: string,
): PlanArtifactState | undefined {
  const state = artifacts().get(sessionId);
  const execution = state?.execution;
  if (!state || !execution || execution.runId !== runId) return state ? copy(state) : undefined;
  if (["completed", "blocked", "failed", "cancelled"].includes(execution.status)) return copy(state);

  const now = Date.now();
  if (goalStatus === "waiting_user") execution.status = "waiting_user";
  else if (goalStatus === "blocked") execution.status = "blocked";
  else if (goalStatus === "cancelled") execution.status = "cancelled";
  else if (goalStatus === "paused") execution.status = "interrupted";
  else if (goalStatus === "complete") execution.status = "failed";
  else return copy(state);
  execution.reason = cleanText(reason || (
    goalStatus === "complete"
      ? "Target mode completed without completing the structured plan execution lifecycle."
      : `Target mode ended with status ${goalStatus}.`
  ), 4_000);
  execution.finishedAt = now;
  touchExecution(state, now);
  return copy(state);
}

export function restorePlanArtifactFromEntries(
  sessionId: string,
  entries: readonly PlanEntryLike[],
): PlanArtifactState | undefined {
  let restored: PlanArtifactState | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== PLAN_ARTIFACT_ENTRY_TYPE) continue;
    if (isPlanArtifactState(entry.data, sessionId)) restored = copy(entry.data);
  }
  if (!restored) {
    artifacts().delete(sessionId);
    return undefined;
  }
  if (restored.execution?.status === "running" || restored.execution?.status === "verifying") {
    const now = Date.now();
    restored.execution.status = "interrupted";
    restored.execution.reason = "Plan execution was restored after its previous runtime ended. Resume the target to continue.";
    restored.execution.updatedAt = now;
    restored.execution.finishedAt = now;
    restored.updatedAt = now;
    restored.plan.updatedAt = now;
    restored.revision += 1;
  }
  artifacts().set(sessionId, restored);
  return copy(restored);
}

export function forgetPlanArtifact(sessionId: string): void {
  artifacts().delete(sessionId);
}

export function resetPlanArtifactRegistryForTests(): void {
  artifacts().clear();
}
