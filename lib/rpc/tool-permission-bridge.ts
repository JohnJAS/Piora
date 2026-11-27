import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "../pi-types";
import { isSubagentTool } from "../subagent-types";
import { recordPromptFileTouch } from "../prompt-file-changes";
import { readEffectiveToolPermission, readToolApprovalSettings } from "../tool-approval-settings";
import { ToolReviewController } from "../tool-permission-gate";
import { isPermissionMode } from "../tool-permission-policy";
import { readToolPermission, selectToolPermission, writeToolPermission } from "../tool-permission-store";
import { readBrowserReviewTarget } from "../tool-review-browser";
import { collectReviewEvidence } from "../tool-review-evidence";
import { runToolReviewModel } from "../tool-review-model";
import type { ToolReviewModel } from "../tool-review-types";
import type { AgentEvent } from "./types";

export interface ToolPermissionBridgeHost {
  readonly sessionId: string;
  getCwd: () => string;
  getInner: () => AgentSessionLike;
  isAlive: () => boolean;
  isStopping: () => boolean;
  getAbortGeneration: () => number;
  getActivePromptRunId: () => string | undefined;
  isToolAllowedByCapability: (name: string) => boolean;
  emit: (event: AgentEvent) => void;
  abortSession: () => void;
  releaseToolApprovals: () => void;
  requestToolApprovalUi: (toolName: string, message: string, signal?: AbortSignal) => Promise<"once" | "full" | "deny">;
}

export class ToolPermissionBridge {
  private permissionRunners = new WeakSet<object>();
  private toolReviews: ToolReviewController | undefined;
  private reviewModel: { provider: string; id: string } | undefined;
  private readonly reviewInvoker: ToolReviewModel;

  constructor(
    private readonly host: ToolPermissionBridgeHost,
    private readonly permissionParent?: ToolPermissionBridge,
    reviewInvoker?: ToolReviewModel,
  ) {
    this.reviewInvoker = reviewInvoker ?? runToolReviewModel;
  }

  reviews(): ToolReviewController {
    return this.toolReviews ??= new ToolReviewController({
      root: getAgentDir(),
      sessionId: this.host.sessionId,
      reviewer: input => this.reviewInvoker(input),
      emit: review => this.host.emit({ type: "tool_review", review }),
      stop: () => { this.host.abortSession(); },
    });
  }

  clearReviewModel(): void {
    this.reviewModel = undefined;
  }

  setReviewModelIfUnset(model: { provider: string; id: string } | undefined): void {
    this.reviewModel ??= model;
  }

  setReviewModel(model: { provider: string; id: string } | undefined): void {
    this.reviewModel = model;
  }

  finishToolCall(toolCallId: string, isError: boolean): void {
    (this.permissionParent ?? this).toolReviews?.finish(toolCallId, isError);
  }

  invalidate(): void {
    this.toolReviews?.invalidate();
  }

  invalidateParent(): void {
    this.permissionParent?.toolReviews?.invalidate();
  }

  cancel(): void {
    this.toolReviews?.cancel();
  }

  refreshToolApprovals(): void {
    this.toolReviews?.invalidate();
    if (!readToolApprovalSettings().enabled) this.host.releaseToolApprovals();
  }

  getToolPermission() {
    return readToolPermission(this.host.sessionId, getAgentDir());
  }

  setToolPermission(mode: unknown, rememberDefault: unknown) {
    if (!isPermissionMode(mode)) throw new Error("Invalid permission mode");
    const permission = rememberDefault === true
      ? selectToolPermission(this.host.sessionId, mode, getAgentDir())
      : writeToolPermission(this.host.sessionId, mode, getAgentDir());
    this.host.emit({ type: "tool_permission_changed", permission });
    this.toolReviews?.invalidate();
    if (permission.mode === "full") this.host.releaseToolApprovals();
    return permission;
  }

  installToolPermissions(): void {
    const inner = this.host.getInner();
    const runner = inner.extensionRunner;
    if (this.permissionRunners.has(runner) || !runner.emitToolCall || !runner.hasHandlers) return;
    this.permissionRunners.add(runner);
    const hasHandlers = runner.hasHandlers.bind(runner);
    const emitToolCall = runner.emitToolCall.bind(runner);
    runner.hasHandlers = event => event === "tool_call" || hasHandlers(event);
    runner.emitToolCall = async event => {
      const owner = this.permissionParent ?? this;
      const generation = this.host.getAbortGeneration();
      const runId = this.host.getActivePromptRunId();
      const active = () => this.host.isAlive() && !this.host.isStopping() && generation === this.host.getAbortGeneration()
        && this.host.getActivePromptRunId() === runId && (!this.permissionParent || this.permissionParent.host.isAlive());
      const result = await emitToolCall(event);
      if (result?.block) return result;
      if (this.permissionParent && !this.host.isToolAllowedByCapability(event.toolName)) return { block: true, reason: "The parent no longer permits this tool." };
      // Delegation itself has no external effect; every actual child tool still
      // passes through the parent's ordinary permission controller below.
      if (isSubagentTool(event.toolName)) return active() && this.host.isToolAllowedByCapability(event.toolName) ? result : { block: true, reason: "Subagents are disabled." };
      const allowActiveTool = async () => {
        const filePath = (event.input as { path?: unknown } | undefined)?.path;
        if (active() && (event.toolName === "write" || event.toolName === "edit") && typeof filePath === "string") {
          await recordPromptFileTouch(owner.host.sessionId, filePath, this.host.getCwd());
        }
        return active() ? result : { block: true, reason: "Operation cancelled." };
      };
      if (!readToolApprovalSettings().enabled) return allowActiveTool();
      const reviews = owner.reviews();
      const allowed = await reviews.authorize({
        name: event.toolName,
        args: event.input,
        toolCallId: event.toolCallId,
        runId: runId ?? `runtime-${generation}`,
        model: owner.reviewModel,
        read: () => readEffectiveToolPermission(owner.host.sessionId, getAgentDir()),
        active,
        evidence: async signal => collectReviewEvidence({
          name: event.toolName,
          args: event.input,
          cwd: this.host.getCwd(),
          tool: inner.getAllTools().find(tool => tool.name === event.toolName),
          browser: event.toolName === "browser" ? await readBrowserReviewTarget(this.host.sessionId, event.input, signal) : undefined,
        }),
        ask: (message, signal) => owner.host.requestToolApprovalUi(event.toolName, message, signal),
        grantFull: () => {
          const permission = selectToolPermission(owner.host.sessionId, "full", getAgentDir());
          owner.host.emit({ type: "tool_permission_changed", permission });
          owner.host.releaseToolApprovals();
        },
      });
      return allowed ? allowActiveTool() : { block: true, ...(reviews.stopped ? { terminate: true } : {}), reason: "Tool operation was declined, invalidated or cancelled. Do not retry through another tool." };
    };
  }
}
