import { reduceAgentPhase, type AgentPhase } from "../agent-phase";
import type { AgentSessionLike } from "../pi-types";
import { activityFromMessage, compactTaskActivityText, TASK_ACTIVITY_STREAM_INTERVAL_MS } from "../rpc-task-activity";
import { projectTaskRun } from "../task-run";
import type { Runtime, TaskRuntimeActivity, TaskRuntimeActivityKind, TaskRuntimeSnapshot } from "../task-status";
import type { AgentEvent } from "./types";

export type StatusPhaseKind = NonNullable<AgentPhase>["kind"] | "agent" | "bash" | null;

export class SessionActivityTracker {
  runStartedAt: number | null = null;
  statusAgentPhase: AgentPhase = null;
  statusPhaseKind: StatusPhaseKind = null;
  statusPhaseStartedAt: number | null = null;
  lastProgressAt: number | null = null;
  compactionStartedAt: number | null = null;
  taskActivity: TaskRuntimeActivity | null = null;
  lastStreamActivityAt = 0;

  setTaskActivity(kind: TaskRuntimeActivityKind, message: unknown, streaming = false): void {
    const now = Date.now();
    if (streaming && now - this.lastStreamActivityAt < TASK_ACTIVITY_STREAM_INTERVAL_MS) return;
    const compact = compactTaskActivityText(message);
    if (!compact) return;
    this.taskActivity = { kind, message: compact, updatedAt: now };
    if (streaming) this.lastStreamActivityAt = now;
  }

  beginRun(kind: TaskRuntimeActivityKind, message: unknown, phaseKind?: "running_command" | "waiting_model"): void {
    this.runStartedAt = Date.now();
    this.statusAgentPhase = null;
    this.statusPhaseKind = kind === "command" ? "bash" : phaseKind ?? "waiting_model";
    this.statusPhaseStartedAt = this.runStartedAt;
    this.lastProgressAt = this.runStartedAt;
    this.lastStreamActivityAt = 0;
    this.setTaskActivity(kind, message);
  }

  markProgress(): void {
    this.lastProgressAt = Date.now();
  }

  updateStatusPhase(event: AgentEvent, inner: AgentSessionLike, stopping: boolean, promptRunning: boolean): void {
    if (inner.isBashRunning || stopping) return;
    const phase = reduceAgentPhase(this.statusAgentPhase, event);
    const phaseKind = phase?.kind ?? (event.type === "agent_end" && promptRunning
      ? "running_command"
      : inner.isStreaming ? "agent" : null);
    if (phaseKind !== this.statusPhaseKind) {
      this.statusPhaseKind = phaseKind;
      this.statusPhaseStartedAt = phaseKind ? Date.now() : null;
    }
    this.statusAgentPhase = phase;
  }

  updateActivityFromEvent(event: AgentEvent): void {
    if (event.type === "agent_start") {
      this.runStartedAt ??= Date.now();
      if (!this.taskActivity) this.setTaskActivity("thinking", "Thinking");
      return;
    }
    if (event.type === "message_start" || event.type === "message_update" || event.type === "message_end") {
      const activity = activityFromMessage(event.message);
      if (activity) this.setTaskActivity(activity.kind, activity.message, event.type === "message_update");
      return;
    }
    if (event.type === "tool_execution_start") {
      const name = compactTaskActivityText(event.toolName, 64) || "tool";
      const input = compactTaskActivityText(event.args ?? event.input ?? event.arguments, 160);
      this.setTaskActivity("tool", input ? `${name}: ${input}` : name);
      return;
    }
    if (event.type === "tool_execution_end") {
      this.setTaskActivity("thinking", "Waiting for the model");
      return;
    }
    if (event.type === "compaction_start" || event.type === "auto_compaction_start") {
      this.compactionStartedAt ??= Date.now();
      this.setTaskActivity("compacting", "Compacting conversation context");
      return;
    }
    if (event.type === "compaction_end" || event.type === "auto_compaction_end") {
      this.compactionStartedAt = null;
      return;
    }
    if (event.type === "auto_retry_start") {
      this.setTaskActivity("retry", event.errorMessage ?? "Retrying the model request");
      return;
    }
    if (event.type === "extension_ui_request") {
      if (event.method === "setStatus") {
        if (event.statusText) this.setTaskActivity("thinking", event.statusText);
        return;
      }
      if (typeof event.method === "string" && ["request_user_input", "select", "confirm", "input", "editor", "custom"].includes(event.method)) {
        this.setTaskActivity("approval", event.title ?? event.message ?? "Waiting for your input");
      }
    }
  }

  buildTaskRuntimeSnapshot(input: {
    sessionId: string;
    runtime: Runtime;
    pendingApproval: boolean;
    lastPromptFailed: boolean;
    lastPromptErrorSummary: string | undefined;
    cachedSessionTitle: string | null;
    fallbackTaskTitle: string | null;
    contextUsage: ReturnType<AgentSessionLike["getContextUsage"]>;
    runningSubagentCount: number | undefined;
    activeGoal?: boolean;
    awaitingPlanApproval?: boolean;
  }): TaskRuntimeSnapshot {
    if (input.runtime === "idle") this.runStartedAt = null;
    else this.runStartedAt ??= Date.now();
    const title = compactTaskActivityText(
      input.cachedSessionTitle || input.fallbackTaskTitle || "",
      80,
    );
    const activeTaskRun = projectTaskRun({
      sessionId: input.sessionId,
      runtime: input.runtime,
      pendingApproval: input.pendingApproval,
      lastPromptFailed: input.lastPromptFailed,
      ...(input.lastPromptErrorSummary ? { errorSummary: input.lastPromptErrorSummary } : {}),
      ...(this.runStartedAt !== null ? { startedAt: this.runStartedAt } : {}),
      ...(title ? { title } : {}),
      ...(this.taskActivity ? { activity: this.taskActivity } : {}),
    });
    return {
      id: input.sessionId,
      runtime: input.runtime,
      pendingApproval: input.pendingApproval,
      lastPromptFailed: input.lastPromptFailed,
      ...(input.lastPromptErrorSummary ? { errorSummary: input.lastPromptErrorSummary } : {}),
      ...(this.runStartedAt !== null ? { startedAt: this.runStartedAt } : {}),
      ...(title ? { title } : {}),
      ...(this.taskActivity ? { activity: this.taskActivity } : {}),
      ...(input.contextUsage ? { contextUsage: input.contextUsage } : {}),
      ...(input.runningSubagentCount ? { runningSubagentCount: input.runningSubagentCount } : {}),
      ...(activeTaskRun ? { taskRun: activeTaskRun } : {}),
      ...(input.activeGoal ? { activeGoal: true } : {}),
      ...(input.awaitingPlanApproval ? { awaitingPlanApproval: true } : {}),
    };
  }
}
