import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  PLAN_ARTIFACT_ENTRY_TYPE,
  addPlanExecutionArtifact,
  addPlanExecutionEvidence,
  beginPlanVerification,
  blockPlanStep,
  capturePlanGitSnapshot,
  completePlanExecution,
  completePlanStep,
  getPlanArtifact,
  restorePlanArtifactFromEntries,
  recordPlanChangeSummary,
  skipPlanStep,
  startPlanStep,
  submitPlanArtifact,
  type PlanArtifactState,
} from "../lib/plan-artifact-registry.ts";
import { getGitStatus } from "../lib/git-changes.ts";

import {
  getActivePromptMode,
  PLAN_MODE_SYSTEM_INSTRUCTION,
} from "../lib/prompt-mode-runtime.ts";
import { requirePromptToolIdentity } from "../lib/prompt-run-registry.ts";

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
    description: "Track the current approved plan while Target Mode executes it. Start and complete dependency-ordered steps, then enter verification and complete the execution lifecycle.",
    promptSnippet: "Track execution progress against the approved structured plan",
    promptGuidelines: [
      "Before working on a step, call start_step. After concrete work and checks for that step, call complete_step with a concise result.",
      "Record evidence for the running step before complete_step. Verification evidence may name zero-based success criterion indices that it proves.",
      "Evidence added through this tool is model-reported. Successful test, typecheck, lint, or git diff --check commands are captured separately by the runtime and cannot be forged through tool parameters.",
      "Record material files, patches, commits, and reports as artifacts linked to the relevant step.",
      "Respect dependsOn. Skip a step only when it is genuinely unnecessary and state why.",
      "If a step cannot proceed, call block_step and then put the target goal into blocked or waiting_user as appropriate.",
      "After every step is completed or skipped, call begin_verification, run at least one applicable verification command, map verification evidence to every success criterion, and record_change_summary before complete_execution.",
      "After complete_execution, record Goal evidence and complete the active target goal.",
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
      const activeMode = getActivePromptMode(sessionId);
      if (activeMode?.mode !== "goal") {
        throw new Error("piora_plan_execution is available only while Target Mode executes an approved plan.");
      }
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
        throw new Error("No approved plan execution is attached to this target-mode run.");
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
    description: "Submit the structured artifact for the current one-shot Piora plan-mode prompt. This writes session metadata only and never executes the plan or mutates the workspace.",
    promptSnippet: "Store a structured plan for explicit user review and approval",
    promptGuidelines: [
      "Use this tool exactly once near the end of a plan-mode response, after inspecting the relevant context.",
      "Make the objective decision-complete, list assumptions explicitly, and provide objectively verifiable success criteria.",
      "Use stable short ids for steps and reference only those ids in dependsOn.",
      "Submitting a plan does not approve or execute it.",
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
      const activeMode = getActivePromptMode(sessionId);
      if (activeMode?.mode !== "plan") {
        throw new Error("piora_plan can only submit an artifact during an active Piora plan-mode prompt.");
      }
      const identity = requirePromptToolIdentity(sessionId, toolCallId);
      if (identity.runId !== activeMode.runId) {
        throw new Error("The plan tool call is not attached to the active plan-mode prompt.");
      }
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
    const active = getActivePromptMode(sessionId);
    if (active?.mode === "goal") {
      const state = getPlanArtifact(sessionId);
      if (!state?.execution || state.execution.runId !== active.runId) return;
      updatePlanUi(ctx, state);
      const steps = state.plan.steps.map((step) => (
        `- [${step.status}] ${step.id}: ${step.title}${step.dependsOn.length ? ` (depends on ${step.dependsOn.join(", ")})` : ""}${step.description ? `\n  ${step.description}` : ""}`
      )).join("\n");
      return {
        message: {
          customType: "piora-plan-execution-context",
          display: false,
          content: `[PIORA APPROVED PLAN EXECUTION]\nObjective: ${state.plan.objective}\n\nSuccess criteria (zero-based indices):\n${state.plan.successCriteria.map((item, index) => `- ${index}: ${item}`).join("\n")}\n\nAssumptions:\n${state.plan.assumptions.map((item) => `- ${item}`).join("\n") || "- None"}\n\nSteps:\n${steps}\n\nRecorded evidence:\n${state.execution.evidence.map((item) => `- [${item.source}] ${item.kind}${item.stepId ? ` for ${item.stepId}` : ""}: ${item.summary}`).join("\n") || "- None"}\n\nRecorded artifacts:\n${state.execution.artifacts.map((item) => `- [${item.source}] ${item.kind}${item.stepId ? ` for ${item.stepId}` : ""}: ${item.name}`).join("\n") || "- None"}\n\nExecute this approved plan in dependency order. Track every transition with piora_plan_execution. A step needs evidence before completion. Model-reported evidence cannot substitute for a successful runtime-captured test, typecheck, lint, or git diff --check. Do not declare the target goal complete until the plan execution has entered verification, runtime verification has succeeded, verification evidence covers every success criterion, a change summary is recorded, and complete_execution has succeeded.`,
        },
      };
    }
    if (active?.mode !== "plan") return;
    ctx.ui.setStatus("piora-plan", "Plan mode · read only");
    return {
      message: {
        customType: "piora-plan-context",
        display: false,
        content: `[PIORA PLAN MODE ACTIVE]\n\n${PLAN_MODE_SYSTEM_INSTRUCTION}`,
      },
    };
  });

  api.on("agent_settled", (_event, ctx) => {
    updatePlanUi(ctx, getPlanArtifact(ctx.sessionManager.getSessionId()));
  });

  api.registerCommand("plan", {
    description: "Show the latest structured plan for this session",
    handler: async (_args, ctx) => {
      const state = getPlanArtifact(ctx.sessionManager.getSessionId());
      updatePlanUi(ctx, state);
      ctx.ui.notify(planSummary(state), state?.status === "cancelled" ? "warning" : "info");
    },
  });
}
