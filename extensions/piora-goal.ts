import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  GOAL_RUN_ENTRY_TYPE,
  addGoalEvidence,
  beginGoalRun,
  blockGoal,
  cancelGoalRun,
  completeGoal,
  getGoalRun,
  pauseGoalRun,
  prepareGoalResume,
  restoreGoalRunFromEntries,
  updateGoalProgress,
  waitGoalForUser,
  type GoalRunState,
} from "../lib/goal-run-registry.ts";
import { getActivePromptRun, requirePromptToolIdentity } from "../lib/prompt-run-registry.ts";

function persistGoal(api: ExtensionAPI, state: GoalRunState): GoalRunState {
  api.appendEntry(GOAL_RUN_ENTRY_TYPE, state);
  return state;
}

function goalSummary(state: GoalRunState | undefined): string {
  if (!state) return "No goal exists for this session.";
  const lines = [
    `Goal: ${state.objective}`,
    `Status: ${state.status}`,
    `Iterations: ${state.iteration}`,
    `Checkpoints: ${state.checkpoints.length}`,
    `Evidence: ${state.evidence.length}`,
  ];
  if (state.progress) lines.push(`Latest progress: ${state.progress}`);
  if (state.summary) lines.push(`Completion: ${state.summary}`);
  if (state.reason) lines.push(`Reason: ${state.reason}`);
  return lines.join("\n");
}

function updateGoalUi(ctx: ExtensionContext, state: GoalRunState | undefined): void {
  if (!state) {
    ctx.ui.setStatus("piora-goal", undefined);
    ctx.ui.setWidget("piora-goal", undefined);
    return;
  }

  const completed = state.status === "complete";
  const statusText = completed
    ? "Goal complete"
    : state.status === "active"
      ? `Goal active · ${state.checkpoints.length} checkpoints`
      : `Goal ${state.status}`;
  ctx.ui.setStatus("piora-goal", statusText);

  if (completed || state.status === "cancelled") {
    ctx.ui.setWidget("piora-goal", undefined);
    return;
  }
  const lines = [
    `[Goal: ${state.status}]`,
    state.objective,
    `Iteration ${state.iteration} · ${state.checkpoints.length} checkpoints · ${state.evidence.length} evidence`,
  ];
  if (state.progress) lines.push(`Latest: ${state.progress}`);
  if (state.reason) lines.push(`Note: ${state.reason}`);
  ctx.ui.setWidget("piora-goal", lines.slice(0, 5), { placement: "aboveEditor" });
}

function createGoalTool(api: ExtensionAPI) {
  return defineTool({
  name: "piora_goal",
  label: "Piora Goals",
  description: "Create, inspect, checkpoint, verify, or finish an optional persistent goal. The tool is available only when the Piora Goals extension is enabled.",
  promptSnippet: "Optionally create and manage persistent goals",
  promptGuidelines: [
    "Call start only when the user explicitly asks to track work as a persistent goal or invokes the goal workflow.",
    "Use progress after material milestones and evidence after concrete verification such as tests, inspected output, or an artifact.",
    "Use complete only after every success criterion is satisfied and concrete evidence has been recorded.",
    "Use waiting_user when a concrete user choice, clarification, or approval is required, and state the exact question.",
    "Use blocked only when unavailable authority or an external state change prevents progress; explain the exact unblock condition.",
    "A goal may remain active across ordinary prompts; this extension does not force automatic model continuations.",
  ],
  executionMode: "sequential",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("start"),
      Type.Literal("status"),
      Type.Literal("progress"),
      Type.Literal("evidence"),
      Type.Literal("complete"),
      Type.Literal("waiting_user"),
      Type.Literal("blocked"),
    ]),
    message: Type.Optional(Type.String({ maxLength: 4_000 })),
    objective: Type.Optional(Type.String({ maxLength: 8_000 })),
    successCriteria: Type.Optional(Type.Array(Type.String({ maxLength: 2_000 }), { maxItems: 32 })),
    constraints: Type.Optional(Type.Array(Type.String({ maxLength: 2_000 }), { maxItems: 32 })),
    evidenceKind: Type.Optional(Type.Union([
      Type.Literal("verification"),
      Type.Literal("artifact"),
      Type.Literal("observation"),
    ])),
  }),
  async execute(toolCallId, params, _signal, _onUpdate, ctx) {
    const identity = requirePromptToolIdentity(ctx.sessionManager.getSessionId(), toolCallId);
    const message = typeof params.message === "string" ? params.message.trim() : "";
    let state: GoalRunState | undefined;
    switch (params.action) {
      case "start":
        state = persistGoal(api, beginGoalRun(identity, params.objective?.trim() || message, {
          successCriteria: params.successCriteria,
          constraints: params.constraints,
        }));
        break;
      case "status":
        state = getGoalRun(identity.sessionId);
        break;
      case "progress":
        state = persistGoal(api, updateGoalProgress(identity, message));
        break;
      case "evidence":
        state = persistGoal(api, addGoalEvidence(identity, message, params.evidenceKind ?? "verification"));
        break;
      case "complete": {
        if (!message) throw new Error("Completion requires a concrete verification summary in message.");
        addGoalEvidence(identity, message, "verification");
        state = persistGoal(api, completeGoal(identity, message));
        break;
      }
      case "blocked":
        state = persistGoal(api, blockGoal(identity, message));
        break;
      case "waiting_user":
        state = persistGoal(api, waitGoalForUser(identity, message));
        break;
    }
    if (!state) throw new Error("No Piora goal exists for this session.");
    if (params.action !== "status" && state.runId !== identity.runId) {
      throw new Error("The goal is not attached to the current prompt. Send another message to resume it.");
    }
    updateGoalUi(ctx, state);
    return {
      content: [{ type: "text" as const, text: goalSummary(state) }],
      details: {
        status: state.status,
        iteration: state.iteration,
        sessionId: state.sessionId,
        goalId: state.goalId,
        runId: state.runId,
        checkpoints: state.checkpoints.length,
        evidence: state.evidence.length,
      },
    };
  },
  });
}

export default function pioraGoal(api: ExtensionAPI) {
  api.registerTool(createGoalTool(api));

  api.on("session_start", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const state = getGoalRun(sessionId)
      ?? restoreGoalRunFromEntries(sessionId, ctx.sessionManager.getBranch());
    updateGoalUi(ctx, state);
  });

  api.on("session_tree", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const state = restoreGoalRunFromEntries(sessionId, ctx.sessionManager.getBranch());
    updateGoalUi(ctx, state);
  });

  api.on("before_agent_start", (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    let state = getGoalRun(sessionId);
    const promptRun = getActivePromptRun(sessionId);
    const isWorkflowCommand = /^[!/]/.test(event.prompt.trimStart());
    if (state && promptRun && !isWorkflowCommand
      && ["active", "paused", "waiting_user", "blocked"].includes(state.status)) {
      state = persistGoal(api, beginGoalRun(promptRun, event.prompt));
    }
    if (!state || state.status !== "active") return;
    updateGoalUi(ctx, state);
    const recent = state.checkpoints.slice(-5).map((checkpoint) => `- ${checkpoint.message}`).join("\n") || "- No checkpoints yet";
    const evidence = state.evidence.slice(-5).map((item) => `- ${item.kind}: ${item.summary}`).join("\n") || "- No evidence yet";
    return {
      message: {
        customType: "piora-goal-context",
        display: false,
        content: `[PIORA GOALS EXTENSION]\nObjective: ${state.objective}\n\nSuccess criteria:\n${state.successCriteria.map((item) => `- ${item}`).join("\n")}\n\nRecent checkpoints:\n${recent}\n\nRecorded evidence:\n${evidence}\n\nContinue the saved goal when it is relevant to the user's current message. Use piora_goal to record meaningful progress, evidence, completion, a user decision, or a genuine blocker. This is optional extension context and does not force automatic continuation.`,
      },
    };
  });

  api.on("agent_settled", (_event, ctx) => {
    updateGoalUi(ctx, getGoalRun(ctx.sessionManager.getSessionId()));
  });

  api.registerCommand("goal", {
    description: "Show or control the optional saved goal: /goal [status|pause|resume|cancel]",
    handler: async (args, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      const [action = "status", ...rest] = args.trim().split(/\s+/);
      const reason = rest.join(" ").trim();
      let state = getGoalRun(sessionId);

      if (action === "pause") {
        state = persistGoal(api, pauseGoalRun(sessionId, reason || undefined));
      } else if (action === "resume") {
        state = persistGoal(api, prepareGoalResume(sessionId));
      } else if (action === "cancel") {
        state = persistGoal(api, cancelGoalRun(sessionId, reason || undefined));
      } else if (action !== "status") {
        ctx.ui.notify("Usage: /goal [status|pause|resume|cancel]", "error");
        return;
      }

      updateGoalUi(ctx, state);
      ctx.ui.notify(goalSummary(state), state?.status === "blocked" ? "warning" : "info");
    },
  });
}
