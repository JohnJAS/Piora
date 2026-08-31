import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  PLAN_ARTIFACT_ENTRY_TYPE,
  addPlanExecutionArtifact,
  addPlanExecutionEvidence,
  approvePlanArtifact,
  beginPlanVerification,
  beginPlanExecution,
  blockPlanStep,
  cancelPlanArtifact,
  capturePlanGitSnapshot,
  capturePlanRuntimeToolResult,
  completePlanExecution,
  completePlanStep,
  getPlanArtifact,
  interruptPlanExecution,
  restorePlanArtifactFromEntries,
  recordPlanChangeSummary,
  resumePlanExecution,
  skipPlanStep,
  startPlanStep,
  submitPlanArtifact,
  type PlanArtifactState,
} from "../lib/plan-artifact-registry.ts";
import { getGitStatus } from "../lib/git-changes.ts";
import { getActivePromptRun, requirePromptToolIdentity } from "../lib/prompt-run-registry.ts";

const requestedExecutions = new Set<string>();
const runtimeToolArguments = new Map<string, unknown>();

function runtimeToolKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

function persistPlan(api: ExtensionAPI, state: PlanArtifactState): PlanArtifactState {
  api.appendEntry(PLAN_ARTIFACT_ENTRY_TYPE, state);
  return state;
}

function planSummary(state: PlanArtifactState | undefined): string {
  if (!state) return "No structured plan exists for this session.";
  return [
    `Plan: ${state.plan.objective}`,
    `Status: ${state.status}`,
    `Revision: ${state.revision}`,
    `Steps: ${state.plan.steps.length}`,
    `Success criteria: ${state.plan.successCriteria.length}`,
  ].join("\n");
}

function updatePlanUi(ctx: ExtensionContext, state: PlanArtifactState | undefined): void {
  if (!state) {
    ctx.ui.setStatus("piora-plan", undefined);
    ctx.ui.setWidget("piora-plan", undefined);
    return;
  }

  const label = state.execution
    ? `Plan execution · ${state.execution.status}`
    : state.status === "draft"
    ? `Plan ready · ${state.plan.steps.length} steps`
    : state.status === "approved"
      ? "Plan approved"
      : "Plan cancelled";
  ctx.ui.setStatus("piora-plan", label);
  if (state.execution) {
    const completed = state.plan.steps.filter((step) => step.status === "completed" || step.status === "skipped").length;
    ctx.ui.setWidget("piora-plan", [
      `[Plan execution: ${state.execution.status}]`,
      state.plan.objective,
      `${completed}/${state.plan.steps.length} steps · attempt ${state.execution.attempt}`,
      ...(state.execution.progress ? [state.execution.progress] : []),
    ], { placement: "aboveEditor" });
    return;
  }
  if (state.status !== "draft") {
    ctx.ui.setWidget("piora-plan", undefined);
    return;
  }
  ctx.ui.setWidget("piora-plan", [
    "[Plan waiting for approval]",
    state.plan.objective,
    `${state.plan.steps.length} steps · revision ${state.revision}`,
  ], { placement: "aboveEditor" });
}

function createPlanExecutionTool(api: ExtensionAPI) {
  return defineTool({
    name: "piora_plan_execution",
    label: "Piora Plan Execution",
    description: "Track an approved plan execution created by the optional Piora Plans extension. Start and complete dependency-ordered steps, then verify the result.",
    promptSnippet: "Track execution progress against the approved structured plan",
    promptGuidelines: [
      "Before working on a step, call start_step. After concrete work and checks for that step, call complete_step with a concise result.",
      "Record evidence for the running step before complete_step. Verification evidence may name zero-based success criterion indices that it proves.",
      "Evidence added through this tool is model-reported. Successful test, typecheck, lint, or git diff --check commands are captured separately by the runtime and cannot be forged through tool parameters.",
      "Record material files, patches, commits, and reports as artifacts linked to the relevant step.",
      "Respect dependsOn. Skip a step only when it is genuinely unnecessary and state why.",
      "If a step cannot proceed, call block_step and explain the exact unblock condition to the user.",
      "After every step is completed or skipped, call begin_verification, run at least one applicable verification command, map verification evidence to every success criterion, and record_change_summary before complete_execution.",
      "This tool tracks only the extension-owned plan; it does not activate any application-level work mode.",
    ],
    executionMode: "sequential",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("status"),
        Type.Literal("start_step"),
        Type.Literal("complete_step"),
        Type.Literal("skip_step"),
        Type.Literal("block_step"),
        Type.Literal("add_evidence"),
        Type.Literal("add_artifact"),
        Type.Literal("begin_verification"),
        Type.Literal("record_change_summary"),
        Type.Literal("complete_execution"),
      ]),
      stepId: Type.Optional(Type.String({ maxLength: 64 })),
      message: Type.Optional(Type.String({ maxLength: 4_000 })),
      evidenceKind: Type.Optional(Type.Union([
        Type.Literal("verification"),
        Type.Literal("artifact"),
        Type.Literal("observation"),
      ])),
      successCriterionIndices: Type.Optional(Type.Array(Type.Integer({ minimum: 0, maximum: 31 }), { maxItems: 32 })),
      artifactKind: Type.Optional(Type.Union([
        Type.Literal("patch"),
        Type.Literal("commit"),
        Type.Literal("report"),
        Type.Literal("file"),
      ])),
      name: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const identity = requirePromptToolIdentity(sessionId, toolCallId);
      const stepId = params.stepId?.trim() ?? "";
      const message = params.message?.trim() ?? "";
      let state = getPlanArtifact(sessionId);
      switch (params.action) {
        case "status":
          break;
        case "start_step":
          state = startPlanStep(identity, stepId);
          break;
        case "complete_step":
          state = completePlanStep(identity, stepId, message);
          break;
        case "skip_step":
          state = skipPlanStep(identity, stepId, message);
          break;
        case "block_step":
          state = blockPlanStep(identity, stepId, message);
          break;
        case "add_evidence":
          state = addPlanExecutionEvidence(
            identity,
            message,
            params.evidenceKind ?? "verification",
            stepId || undefined,
            params.successCriterionIndices ?? [],
          );
          break;
        case "add_artifact":
          state = addPlanExecutionArtifact(
            identity,
            params.name?.trim() ?? "",
            params.artifactKind ?? "file",
            message || undefined,
            stepId || undefined,
          );
          break;
        case "begin_verification":
          state = beginPlanVerification(identity);
          try {
            state = capturePlanGitSnapshot(identity, await getGitStatus(ctx.sessionManager.getCwd()));
          } catch {
            // Entering verification must not fail because the workspace cannot be inspected as Git.
          }
          break;
        case "record_change_summary":
          state = recordPlanChangeSummary(identity, message);
          break;
        case "complete_execution":
          state = completePlanExecution(identity, message);
          break;
      }
      if (!state?.execution || state.execution.runId !== identity.runId) {
        throw new Error("No approved plan execution is attached to the current extension turn.");
      }
      if (params.action !== "status") persistPlan(api, state);
      updatePlanUi(ctx, state);
      return {
        content: [{ type: "text" as const, text: planExecutionSummary(state) }],
        details: {
          planId: state.plan.id,
          executionId: state.execution.executionId,
          status: state.execution.status,
          attempt: state.execution.attempt,
          revision: state.revision,
          steps: state.plan.steps.map((step) => ({ id: step.id, status: step.status })),
          evidence: state.execution.evidence.length,
          artifacts: state.execution.artifacts.length,
        },
      };
    },
  });
}

function planExecutionSummary(state: PlanArtifactState): string {
  const execution = state.execution!;
  const steps = state.plan.steps.map((step) => `- ${step.id}: ${step.status} — ${step.title}`);
  return [
    `Plan execution: ${execution.status}`,
    `Attempt: ${execution.attempt}`,
    ...steps,
    ...(execution.progress ? [`Progress: ${execution.progress}`] : []),
    `Evidence: ${execution.evidence.length}`,
    `Runtime-captured evidence: ${execution.evidence.filter((item) => item.source === "runtime").length}`,
    `Artifacts: ${execution.artifacts.length}`,
    ...(execution.changeSummary ? [`Change summary: ${execution.changeSummary}`] : []),
    ...(execution.reason ? [`Reason: ${execution.reason}`] : []),
  ].join("\n");
}

function createPlanTool(api: ExtensionAPI) {
  return defineTool({
    name: "piora_plan",
    label: "Piora Structured Plan",
    description: "Save a structured plan as optional extension metadata for later review. Saving a plan does not approve or execute it.",
    promptSnippet: "Optionally store a structured plan for explicit user review",
    promptGuidelines: [
      "Use this tool when the user explicitly asks to create and save a structured plan.",
      "Make the objective decision-complete, list assumptions explicitly, and provide objectively verifiable success criteria.",
      "Use stable short ids for steps and reference only those ids in dependsOn.",
      "Submitting a plan does not approve or execute it.",
      "The tool does not make the workspace read-only; obey the user's requested scope for the current prompt.",
    ],
    executionMode: "sequential",
    parameters: Type.Object({
      objective: Type.String({ maxLength: 8_000 }),
      assumptions: Type.Optional(Type.Array(Type.String({ maxLength: 2_000 }), { maxItems: 32 })),
      successCriteria: Type.Array(Type.String({ maxLength: 2_000 }), { minItems: 1, maxItems: 32 }),
      steps: Type.Array(Type.Object({
        id: Type.String({ maxLength: 64 }),
        title: Type.String({ maxLength: 500 }),
        description: Type.Optional(Type.String({ maxLength: 4_000 })),
        dependsOn: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 32 })),
      }), { minItems: 1, maxItems: 64 }),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      const identity = requirePromptToolIdentity(sessionId, toolCallId);
      const state = persistPlan(api, submitPlanArtifact(identity, {
        objective: params.objective,
        assumptions: params.assumptions,
        successCriteria: params.successCriteria,
        steps: params.steps,
      }));
      updatePlanUi(ctx, state);
      return {
        content: [{ type: "text" as const, text: `${planSummary(state)}\nThe plan is saved and waiting for explicit user approval.` }],
        details: {
          sessionId: state.sessionId,
          runId: state.runId,
          planId: state.plan.id,
          status: state.status,
          revision: state.revision,
          steps: state.plan.steps.length,
        },
      };
    },
  });
}

export default function pioraPlan(api: ExtensionAPI) {
  api.registerTool(createPlanTool(api));
  api.registerTool(createPlanExecutionTool(api));

  api.on("session_start", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const state = getPlanArtifact(sessionId)
      ?? restorePlanArtifactFromEntries(sessionId, ctx.sessionManager.getBranch());
    updatePlanUi(ctx, state);
  });

  api.on("session_tree", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    updatePlanUi(ctx, restorePlanArtifactFromEntries(sessionId, ctx.sessionManager.getBranch()));
  });

  api.on("before_agent_start", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const promptRun = getActivePromptRun(sessionId);
    let state = getPlanArtifact(sessionId);
    if (promptRun && requestedExecutions.delete(sessionId) && state) {
      state = state.execution && ["blocked", "failed", "interrupted", "waiting_user"].includes(state.execution.status)
        ? persistPlan(api, resumePlanExecution(promptRun))
        : persistPlan(api, beginPlanExecution(promptRun, state.plan.id, state.revision));
    }
    if (promptRun && state?.execution?.runId === promptRun.runId
      && ["running", "verifying"].includes(state.execution.status)) {
      updatePlanUi(ctx, state);
      const steps = state.plan.steps.map((step) => (
        `- [${step.status}] ${step.id}: ${step.title}${step.dependsOn.length ? ` (depends on ${step.dependsOn.join(", ")})` : ""}${step.description ? `\n  ${step.description}` : ""}`
      )).join("\n");
      return {
        message: {
          customType: "piora-plan-execution-context",
          display: false,
          content: `[PIORA PLANS EXTENSION EXECUTION]\nObjective: ${state.plan.objective}\n\nSuccess criteria (zero-based indices):\n${state.plan.successCriteria.map((item, index) => `- ${index}: ${item}`).join("\n")}\n\nAssumptions:\n${state.plan.assumptions.map((item) => `- ${item}`).join("\n") || "- None"}\n\nSteps:\n${steps}\n\nRecorded evidence:\n${state.execution.evidence.map((item) => `- [${item.source}] ${item.kind}${item.stepId ? ` for ${item.stepId}` : ""}: ${item.summary}`).join("\n") || "- None"}\n\nRecorded artifacts:\n${state.execution.artifacts.map((item) => `- [${item.source}] ${item.kind}${item.stepId ? ` for ${item.stepId}` : ""}: ${item.name}`).join("\n") || "- None"}\n\nExecute this approved extension-owned plan in dependency order. Track transitions with piora_plan_execution. A step needs evidence before completion. Model-reported evidence cannot substitute for successful runtime-captured verification. Complete the execution only after verification evidence covers every success criterion and a change summary is recorded.`,
        },
      };
    }
  });

  api.on("tool_execution_start", (event, ctx) => {
    runtimeToolArguments.set(runtimeToolKey(ctx.sessionManager.getSessionId(), event.toolCallId), event.args);
  });

  api.on("tool_execution_end", (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const key = runtimeToolKey(sessionId, event.toolCallId);
    const args = runtimeToolArguments.get(key);
    runtimeToolArguments.delete(key);
    const promptRun = getActivePromptRun(sessionId);
    if (!promptRun) return;
    const previous = getPlanArtifact(sessionId);
    const state = capturePlanRuntimeToolResult(
      promptRun,
      event.toolCallId,
      event.toolName,
      args,
      event.isError,
      event.result,
    );
    if (state && state.revision !== previous?.revision) {
      persistPlan(api, state);
      updatePlanUi(ctx, state);
    }
  });

  api.on("session_shutdown", (_event, ctx) => {
    const prefix = `${ctx.sessionManager.getSessionId()}:`;
    for (const key of runtimeToolArguments.keys()) {
      if (key.startsWith(prefix)) runtimeToolArguments.delete(key);
    }
    requestedExecutions.delete(ctx.sessionManager.getSessionId());
  });

  api.on("agent_settled", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const promptRun = getActivePromptRun(sessionId);
    let state = getPlanArtifact(sessionId);
    if (promptRun && state?.execution?.runId === promptRun.runId
      && ["running", "verifying"].includes(state.execution.status)) {
      state = interruptPlanExecution(sessionId, promptRun.runId);
      if (state) persistPlan(api, state);
    }
    updatePlanUi(ctx, state);
  });

  api.registerCommand("plan", {
    description: "Control the optional structured plan: /plan [status|approve|cancel|execute]",
    handler: async (args, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      const action = args.trim().toLowerCase() || "status";
      let state = getPlanArtifact(sessionId);
      if (action === "approve") {
        if (!state) throw new Error("No structured plan exists for this session.");
        state = persistPlan(api, approvePlanArtifact(sessionId, state.revision));
      } else if (action === "cancel") {
        if (!state) throw new Error("No structured plan exists for this session.");
        state = persistPlan(api, cancelPlanArtifact(sessionId, state.revision));
      } else if (action === "execute") {
        if (!state || (state.status !== "approved" && !state.execution)) {
          throw new Error("Approve the saved plan before executing it.");
        }
        requestedExecutions.add(sessionId);
        api.sendUserMessage(`Execute the approved saved plan: ${state.plan.objective}`);
        ctx.ui.notify("Plan execution queued by the Piora Plans extension.", "info");
        return;
      } else if (action !== "status") {
        ctx.ui.notify("Usage: /plan [status|approve|cancel|execute]", "error");
        return;
      }
      updatePlanUi(ctx, state);
      ctx.ui.notify(planSummary(state), state?.status === "cancelled" ? "warning" : "info");
    },
  });
}
