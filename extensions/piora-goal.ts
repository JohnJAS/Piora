import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { blockGoal, completeGoal, getGoalRun, updateGoalProgress } from "../lib/goal-run-registry.ts";
import { requirePromptToolIdentity } from "../lib/prompt-run-registry.ts";

const goalTool = defineTool({
  name: "piora_goal",
  label: "Piora Target Mode",
  description: "Report progress or explicitly finish a Piora target-mode run. A target-mode run continues across model turns until this tool marks it complete or blocked, or the user stops it.",
  promptSnippet: "Manage the lifecycle of an active Piora target-mode run",
  promptGuidelines: [
    "When Piora says target mode remains active, continue working instead of ending the response.",
    "Use progress after material milestones. Use complete only after verifying the requested outcome with concrete evidence.",
    "Use blocked only when the goal cannot be advanced without user input, unavailable authority, or an external state change; explain the exact unblock condition.",
    "Never mark a goal complete merely because a model turn, time budget, or iteration limit is ending.",
  ],
  executionMode: "sequential",
  parameters: Type.Object({
    action: Type.Union([Type.Literal("status"), Type.Literal("progress"), Type.Literal("complete"), Type.Literal("blocked")]),
    message: Type.Optional(Type.String({ maxLength: 4_000 })),
  }),
  async execute(toolCallId, params, _signal, _onUpdate, ctx) {
    const identity = requirePromptToolIdentity(ctx.sessionManager.getSessionId(), toolCallId);
    const message = typeof params.message === "string" ? params.message.trim() : "";
    const state = params.action === "status"
      ? getGoalRun(identity.sessionId)
      : params.action === "progress"
        ? updateGoalProgress(identity, message || "Work is continuing.")
        : params.action === "complete"
          ? completeGoal(identity, message || "The requested outcome was verified.")
          : blockGoal(identity, message || "The goal cannot proceed without an external change.");
    if (!state || state.runId !== identity.runId) throw new Error("No active Piora target-mode run is attached to this tool call.");
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        status: state.status,
        objective: state.objective,
        iteration: state.iteration,
        progress: state.progress,
        summary: state.summary,
        reason: state.reason,
      }) }],
      details: { status: state.status, iteration: state.iteration, sessionId: state.sessionId, runId: state.runId },
    };
  },
});

export default function pioraGoal(api: ExtensionAPI) {
  api.registerTool(goalTool);
}
