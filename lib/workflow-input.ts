import type { WorkflowAction, WorkflowCriterion, WorkflowMode, WorkflowPromptOptions } from "./workflow-types";

export class WorkflowInputError extends Error {
  readonly code = "INVALID_WORKFLOW_INPUT";
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkflowInputError("Invalid workflow request.");
  return value as Record<string, unknown>;
}

export function parseWorkflowMode(value: unknown): WorkflowMode {
  if (value !== "agent" && value !== "plan" && value !== "goal") throw new WorkflowInputError("Choose Agent, Plan, or Goal.");
  return value;
}

export function parseWorkflowBudget(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 100) throw new WorkflowInputError("The workflow turn budget must be an integer from 1 to 100.");
  return value;
}

export function parseWorkflowPromptOptions(value: unknown): WorkflowPromptOptions | undefined {
  if (value === undefined) return undefined;
  const input = record(value);
  return {
    mode: parseWorkflowMode(input.mode),
    ...(input.turnBudget !== undefined ? { turnBudget: parseWorkflowBudget(input.turnBudget) } : {}),
    ...(input.preservePausedGoal === true ? { preservePausedGoal: true } : {}),
    ...(input.resumePausedGoal === true ? { resumePausedGoal: true } : {}),
  };
}

export function parseWorkflowRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new WorkflowInputError("A workflow revision is required. Refresh the current workflow.");
  return value;
}

function parseOptionalText(value: unknown, field: string, limit: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new WorkflowInputError(`${field} is empty or too large.`);
  }
  return value;
}

function parseOptionalCriteria(value: unknown): WorkflowCriterion[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 50) {
    throw new WorkflowInputError("Acceptance criteria must be a list of up to 50 items.");
  }
  return value.map((item, index) => {
    const entry = record(item);
    const id = parseOptionalText(entry.id, `criteria[${index}].id`, 100);
    const text = parseOptionalText(entry.text, `criteria[${index}].text`, 5000);
    const status = entry.status;
    if (!id || !text || (status !== "pending" && status !== "verified")) {
      throw new WorkflowInputError(`criteria[${index}] is invalid.`);
    }
    const evidence = typeof entry.evidence === "string" && entry.evidence.length <= 20_000 ? entry.evidence : "";
    return { id, text, evidence, status };
  });
}

const VALID_WORKFLOW_ACTIONS = new Set([
  "approve",
  "revise",
  "exit",
  "pause",
  "resume",
  "cancel",
  "set_budget",
  "edit_goal",
  "replace_goal",
]);

export function parseWorkflowAction(value: unknown): WorkflowAction {
  const input = record(value);
  if (!VALID_WORKFLOW_ACTIONS.has(String(input.action))) throw new WorkflowInputError("Unknown workflow action.");
  if (typeof input.runId !== "string" || !input.runId || input.runId.length > 128) throw new WorkflowInputError("A workflow run ID is required.");
  const objective = parseOptionalText(input.objective, "objective", 100_000);
  const criteria = parseOptionalCriteria(input.criteria);
  const planMarkdown = parseOptionalText(input.planMarkdown, "planMarkdown", 100_000);
  return {
    action: input.action as WorkflowAction["action"],
    runId: input.runId,
    expectedRevision: parseWorkflowRevision(input.expectedRevision),
    ...(input.turnBudget !== undefined ? { turnBudget: parseWorkflowBudget(input.turnBudget) } : {}),
    ...(objective !== undefined ? { objective } : {}),
    ...(criteria !== undefined ? { criteria } : {}),
    ...(planMarkdown !== undefined ? { planMarkdown } : {}),
  };
}
