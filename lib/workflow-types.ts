/** Serializable workflow contracts shared by the runtime and chat UI. */
export type WorkflowMode = "agent" | "plan" | "goal";
export interface WorkflowPromptOptions {
  mode: WorkflowMode;
  turnBudget?: number;
  /** Keep an existing paused Goal untouched while running an ordinary Agent message. */
  preservePausedGoal?: boolean;
  /** Explicitly resume an existing paused Goal with the submitted user message. */
  resumePausedGoal?: boolean;
}
export type WorkflowStatus = "planning" | "awaiting_approval" | "running" | "completed" | "waiting" | "paused" | "cancelled" | "failed" | "budget_exhausted";
export interface WorkflowCriterion { id: string; text: string; evidence: string; status: "pending" | "verified" }
export type WorkflowTodoStepStatus = "pending" | "in_progress" | "completed";
export interface WorkflowTodoStep {
  id: string;
  label: string;
  status: WorkflowTodoStepStatus;
}
export interface CompletedGoalBadge {
  runId: string;
  objective: string;
  totalTimeMs: number;
  completedAt: number;
}
export interface WorkflowRun {
  id: string;
  kind: "plan" | "goal";
  status: WorkflowStatus;
  objective: string;
  title: string;
  markdown: string;
  criteria: WorkflowCriterion[];
  progress: string;
  reason: string;
  turnBudget: number;
  turnsUsed: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Number of consecutive turns without new recorded progress or tool evidence. */
  noProgressTurns: number;
  /** Structured step progress updated via piora_update_steps or piora_update_goal. */
  steps?: WorkflowTodoStep[];
  /** Absolute path to the persisted editable PLAN.md snapshot under agentDir/piora/plans. */
  planFilePath?: string;
  /** True when the user saved edits to PLAN.md before approving implementation. */
  planEditedByUser?: boolean;
  /** Accumulated active execution duration in milliseconds (excludes paused/waiting time). */
  timeUsedMs?: number;
  /** Epoch timestamp (ms) when active execution started, or null while paused/terminal. */
  activeSince?: number | null;
  /** Epoch timestamp (ms) when a run reached completed status. */
  completedAt?: number | null;
}
export interface WorkflowSnapshot {
  sessionId: string;
  revision: number;
  mode: WorkflowMode;
  turnBudget: number;
  current: WorkflowRun | null;
  history: WorkflowRun[];
  /** Latest step checklist carried across turns (used by the floating step progress pill). */
  todoSteps?: WorkflowTodoStep[];
  /** Most recently achieved goal summary for the inline "Goal achieved in ..." badge. */
  completedGoal?: CompletedGoalBadge | null;
  /** Transient live flag: true between Goal agent_end and the auto-continued next turn start. */
  autoContinuing?: boolean;
}
export type WorkflowActionName =
  | "approve"
  | "revise"
  | "exit"
  | "pause"
  | "resume"
  | "cancel"
  | "set_budget"
  | "edit_goal"
  | "replace_goal";
export interface WorkflowAction {
  action: WorkflowActionName;
  runId: string;
  expectedRevision: number;
  turnBudget?: number;
  objective?: string;
  criteria?: WorkflowCriterion[];
  planMarkdown?: string;
  /** User feedback submitted together with a Plan revision. */
  feedback?: string;
  /** Per-attempt identity so a cancelled submission can be retried safely. */
  submissionId?: string;
}
export interface WorkflowActionResult { snapshot: WorkflowSnapshot; prompt?: string }
export const DEFAULT_WORKFLOW_TURN_BUDGET = 10;
export const MAX_WORKFLOW_TURN_BUDGET = 100;
