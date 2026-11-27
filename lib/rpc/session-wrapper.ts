import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AgentRuntimeProfile } from "../agent-runtime-profile";
import { recordAgentTerminalEvent } from "../agent-terminal-registry";
import { installAnalyticsFileObserver, withAnalyticsSession } from "../analytics-telemetry";
import { ChatCommandActivityTracker } from "../chat-command-activity";
import type { ChatCommandPhase } from "../chat-command-types";
import { mergeCommandOutputDetails } from "../command-execution";
import type { NativeMcpController } from "../native-mcp";
import type { AgentSessionLike, ExtensionUiContextLike } from "../pi-types";
import type { ProjectToolSettingsRecord } from "../project-tool-settings";
import { beginPromptFileChanges, finishPromptFileChanges } from "../prompt-file-changes";
import { PromptInputEnrichment } from "../prompt-input-enrichment";
import type { PromptMaterialReference } from "../prompt-material-format";
import { buildPromptWithMaterials, resolvePromptMaterialReferences } from "../prompt-materials";
import { beginPromptRun, finishPromptRun, type PromptRunIdentity } from "../prompt-run-registry";
import { RemoteContentProjection } from "../remote-content";
import { assertRemotePolicyCommand, readRemoteSessionPolicy, type RemoteSessionPolicy } from "../remote-session-policy";
import { getRoom, listRooms } from "../room-store";
import { notifyRunningChange, scheduleRunningChange } from "../rpc-running-status";
import { compactTaskActivityText } from "../rpc-task-activity";
import { isRunProgressEvent } from "../run-progress";
import type { SessionCapabilitiesState, SessionCapabilityPolicy } from "../session-capabilities";
import { authorizeSessionCommand, enforceCommandProfile, recheckCommandSession, type SessionRpcCommand } from "../session-command-policy";
import type { SessionMessageSourceKind, SessionRoomContext } from "../session-message-types";
import { trackSessionFileOperation } from "../session-mutation";
import { persistLazySessionManager } from "../session-persistence";
import { cacheSessionPath, invalidateSessionListCache } from "../session-reader";
import { parseRuntimeStateView, projectRuntimeContext, type SessionRuntimeStateView } from "../session-runtime-context";
import { summarizeLiveSessionStats } from "../session-stats";
import { summarizeSessionSystemPromptBinding } from "../session-system-prompt";
import { deriveSideChatAutoTitle, isDefaultSideChatTitle } from "../side-chat/composer-trigger";
import { readSideChatMetaFromEntries } from "../side-chat/store";
import type { SideChatMetaEntry } from "../side-chat/types";
import { StreamingMetricsTracker } from "../streaming-metrics";
import { createSubagentDriver } from "../subagent-driver";
import { bindSubagentRuntime, SubagentRuntime } from "../subagent-runtime";
import { projectSubagentDetail, type SubagentRecord } from "../subagent-types";
import type { SessionSystemPromptBinding, SystemPromptSelection } from "../system-prompt-types";
import type { Runtime, TaskRuntimeSnapshot } from "../task-status";
import { TeamError } from "../team-errors";
import { validateTeamExecutionContext } from "../team-prompt-context";
import { captureTeamRuntimeToolResult } from "../team-runtime-evidence";
import type { TeamExecutionContext } from "../team-types";
import type { ToolReviewModel } from "../tool-review-types";
import type { ExtensionUiRequest, ExtensionUiResponse } from "../types";
import { findWorkflowRuntime, getWorkflowRuntime, readWorkflowSnapshot, WorkflowError } from "../workflow-runtime";
import type { WorkflowAction, WorkflowPromptOptions } from "../workflow-types";
import { SessionCapabilityController } from "./capability-controller";
import { handleAbortBashCommand, handleAbortCommand, handleAbortCompactionCommand } from "./commands/abort-command";
import type { RpcCommandHost } from "./commands/host";
import { handleCompactCommand, handleSetModelCommand, handleSetThinkingLevelCommand } from "./commands/model-command";
import { handlePromptCommand, handleQueueCommand, preflightPromptOrQueueCommand } from "./commands/prompt-command";
import {
  handleBashCommand,
  handleForkCommand,
  handleGetCommandsCommand,
  handleGetSessionStatsCommand,
  handleNavigateTreeCommand,
  handleReloadCommand,
  handleWorkflowActionCommand,
  handleWorkflowConfigureCommand,
  handleWorkflowSavePlanCommand,
} from "./commands/session-commands";
import { ExtensionUiBridge } from "./extension-ui-bridge";
import { SessionQueueTracker } from "./queue-tracker";
import { isImmediateRunningSnapshotEvent } from "./registry";
import { SessionActivityTracker } from "./runtime-activity-tracker";
import { SystemPromptReloader } from "./system-prompt-reloader";
import { ToolPermissionBridge } from "./tool-permission-bridge";
import {
  DEVICE_CONTROL_DENIED_RPC_COMMANDS,
  type AgentEvent,
  type EventListener,
  type ExtensionBindingOptions,
  type ExtensionCommandContextActionsLike,
  type RpcSessionStartOptions,
} from "./types";

export type RpcSessionStarter = (
  sessionId: string,
  sessionFile: string,
  cwd: string,
  options?: RpcSessionStartOptions,
) => Promise<{ session: AgentSessionWrapper; realSessionId: string }>;

let registeredSessionStarter: RpcSessionStarter | undefined;

export function registerRpcSessionStarter(starter: RpcSessionStarter): void {
  registeredSessionStarter = starter;
}

export class AgentSessionWrapper {
  private readonly permissionParent?: AgentSessionWrapper;
  private readonly subagentUiController = new AbortController();
  private subagents?: SubagentRuntime;
  private readonly uiBridge: ExtensionUiBridge;
  private readonly permissions: ToolPermissionBridge;
  private readonly capabilities: SessionCapabilityController;
  private readonly queueTracker: SessionQueueTracker;
  private readonly activity = new SessionActivityTracker();
  private readonly systemPromptReloader: SystemPromptReloader;
  readonly remotePolicy: RemoteSessionPolicy;
  private readonly remoteContent = new RemoteContentProjection();
  private listeners: EventListener[] = [];
  private promptRunning = false;
  // Synchronous admission guard shared by UI and routed prompts. The guard is
  // set before the async SDK call so two callers cannot both observe idle.
  private promptAdmissionBusy = false;
  private stopping = false;
  private abortedQueuedMessages: { id: string; steering: string[]; followUp: string[] } | undefined;
  private abortCleanupTask: Promise<void> = Promise.resolve();
  private shutdownTask: Promise<void> = Promise.resolve();
  private abortGeneration = 0;
  private promptTasks = new Set<Promise<void>>();
  private inputAdmissions = 0;
  private readonly chatCommandActivities = new ChatCommandActivityTracker();
  private lastPromptFailed = false;
  private lastAssistantResponse: unknown;
  private readonly streamingMetrics = new StreamingMetricsTracker();
  private pendingClientPromptId: string | undefined;
  private lastPromptErrorSummary: string | undefined;
  private cachedSessionTitle: string | null = null;
  private fallbackTaskTitle: string | null = null;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallbacks = new Set<() => void>();
  private unsubscribeWorkflow?: () => void;
  private activePromptRun: PromptRunIdentity | undefined;
  private readonly promptInputEnrichment = new PromptInputEnrichment();
  private activeCommandId: string | undefined;
  private runtimeToolCalls = new Map<string, { toolName: string; args: unknown; outputDetails?: Record<string, unknown> }>();
  private stoppedInputRecovery: Promise<void> = Promise.resolve();
  private readonly _projectRoot: string;
  private readonly sideChatMeta?: SideChatMetaEntry;
  private _alive = true;
  readonly nativeMcp?: NativeMcpController;

  constructor(
    public readonly inner: AgentSessionLike,
    public readonly runtimeProfile: AgentRuntimeProfile = "normal",
    capabilityOptions: {
      policy?: SessionCapabilityPolicy;
      toolNameCeiling?: readonly string[];
      projectRoot?: string;
      projectManaged?: boolean;
      nativeMcp?: NativeMcpController;
      /** Host-only dependency injection for deterministic integration tests. Never a model/API option. */
      reviewInvoker?: ToolReviewModel;
      subagentParent?: AgentSessionWrapper;
      sideChatMeta?: SideChatMetaEntry;
    } = {},
  ) {
    this.permissionParent = capabilityOptions.subagentParent;
    this.nativeMcp = capabilityOptions.nativeMcp;
    this.sideChatMeta = capabilityOptions.sideChatMeta ?? readSideChatMetaFromEntries(inner.sessionManager.getEntries());
    this.remotePolicy = readRemoteSessionPolicy(inner.sessionManager.getEntries());
    this.cachedSessionTitle = inner.sessionManager.getSessionName()?.trim() || null;
    this._projectRoot = capabilityOptions.projectRoot ?? inner.sessionManager.getCwd();

    this.uiBridge = new ExtensionUiBridge({
      isAlive: () => this._alive,
      isStopping: () => this.stopping,
      getAbortGeneration: () => this.abortGeneration,
      getInner: () => this.inner,
      getPermissionParentUi: () => this.permissionParent?.uiBridge,
      getSubagentUiSignal: () => this.subagentUiController.signal,
      getChatCommandActivity: () => this.chatCommandActivities,
      emit: (event) => this.emit(event),
      applyForcedEmptySystemPrompt: () => this.systemPromptReloader.applyForcedEmptySystemPrompt(),
    });

    this.systemPromptReloader = new SystemPromptReloader({
      sessionId: this.sessionId,
      runtimeProfile: this.runtimeProfile,
      getInner: () => this.inner,
      isAlive: () => this._alive,
      isRunning: () => this.isRunning(),
      assertSessionIdle: (action) => this.assertSessionIdle(action),
      waitForExtensionsBound: () => this.waitForExtensionsBound(),
      clearUiStatusesAndWidgets: () => this.uiBridge.clearStatusesAndWidgets(),
      createExtensionUiContext: () => this.uiBridge.createExtensionUiContext(),
      reapplySessionCapabilities: () => this.capabilities.reapplySessionCapabilities(),
      emit: (event) => this.emit(event),
    });

    this.capabilities = new SessionCapabilityController({
      runtimeProfile: this.runtimeProfile,
      remotePolicy: this.remotePolicy,
      getInner: () => this.inner,
      isAlive: () => this._alive,
      isRunning: () => this.isRunning(),
      assertSessionIdle: (action) => this.assertSessionIdle(action),
      getPermissionParent: () => this.permissionParent,
      getSideChatMeta: () => this.sideChatMeta,
      setForceEmptySystemPrompt: (force) => this.setForceEmptySystemPrompt(force),
      applyForcedEmptySystemPrompt: () => this.systemPromptReloader.applyForcedEmptySystemPrompt(),
      emit: (event) => this.emit(event),
    }, {
      policy: capabilityOptions.policy,
      toolNameCeiling: capabilityOptions.toolNameCeiling,
      projectManaged: capabilityOptions.projectManaged,
      nativeMcp: capabilityOptions.nativeMcp,
    });

    this.permissions = new ToolPermissionBridge({
      sessionId: this.sessionId,
      getCwd: () => this.cwd,
      getInner: () => this.inner,
      isAlive: () => this._alive,
      isStopping: () => this.stopping,
      getAbortGeneration: () => this.abortGeneration,
      getActivePromptRunId: () => this.activePromptRun?.runId,
      isToolAllowedByCapability: (name) => this.isToolAllowedByCapability(name),
      emit: (event) => this.emit(event),
      abortSession: () => { void this.send({ type: "abort" }).catch(() => undefined); },
      releaseToolApprovals: () => this.uiBridge.releaseToolApprovals(),
      requestToolApprovalUi: (toolName, message, signal) => this.uiBridge.requestExtensionUi<"once" | "full" | "deny">(
        { method: "confirm", toolApproval: true, title: toolName, message },
        "deny",
        response => "value" in response && response.value === "full" ? "full"
          : "confirmed" in response && response.confirmed ? "once" : "deny",
        10 * 60_000,
        signal,
      ),
    }, capabilityOptions.subagentParent?.permissions, capabilityOptions.reviewInvoker);

    this.queueTracker = new SessionQueueTracker(
      this.inner,
      () => this._alive,
      (event) => this.emit(event),
      this.promptInputEnrichment,
    );

    this.permissions.installToolPermissions();
    const reload = inner.reload.bind(inner);
    inner.reload = options => reload({
      ...options,
      beforeSessionStart: async () => {
        this.permissions.installToolPermissions();
        installAnalyticsFileObserver(inner, this.cwd, this.sessionId);
        await options?.beforeSessionStart?.();
      },
    });
    // Fence late starts inside the SDK's agent.prompt try/finally, so its
    // active-run state and idle waiters also settle after preflight cancellation.
    const agentPrompt = inner.agent.prompt;
    if (agentPrompt) inner.agent.prompt = new Proxy(agentPrompt, {
      apply: (target, receiver, args) => {
        if (!this._alive || this.stopping) throw new Error("Prompt cancelled");
        return Reflect.apply(target, receiver, args);
      },
    });
    this.queueTracker.installQueueHooks();
    const prompt = inner.prompt.bind(inner);
    inner.prompt = (text, options) => {
      const execute = () => this.promptInputEnrichment.isolate(options?.source === "rpc", () => this.chatCommandActivities.track(prompt(text, {
        ...options,
        preflightResult: disposition => {
          if (disposition === "started" || disposition === "queued") this.chatCommandActivities.phase("model");
          options?.preflightResult?.(disposition);
        },
      })));
      if (options?.source === "extension" && !this.chatCommandActivities.commandId && !this.activePromptRun) {
        return this.executeChatCommand(`cmd_${randomUUID()}`, text, undefined, { execute, source: "extension" });
      }
      return withAnalyticsSession(this.sessionId, execute);
    };
    const sendCustomMessage = inner.sendCustomMessage?.bind(inner);
    if (sendCustomMessage) inner.sendCustomMessage = (message, options) => {
      const execute = () => {
        if (options?.triggerTurn) this.chatCommandActivities.phase("model");
        return this.chatCommandActivities.track(sendCustomMessage(message, options));
      };
      if (options?.triggerTurn && !this.chatCommandActivities.commandId && !this.activePromptRun) {
        return this.executeChatCommand(`cmd_${randomUUID()}`, "Extension message", undefined, { execute, source: "extension" });
      }
      return withAnalyticsSession(this.sessionId, execute);
    };
  }

  getPendingInputs() { return this.queueTracker.getPendingInputs(); }
  prepareQueueRecall(inputId?: string) { return this.queueTracker.prepareQueueRecall(inputId); }

  get sessionId(): string { return this.inner.sessionId; }
  get sessionFile(): string { return this.inner.sessionFile ?? ""; }
  get cwd(): string { return this.inner.sessionManager.getCwd(); }
  get projectRoot(): string {
    // Hot reload can retain a wrapper created before project-scoped tools were
    // introduced. Fall back to its cwd until that wrapper naturally restarts.
    return this._projectRoot ?? this.cwd;
  }

  isAlive(): boolean { return this._alive; }
  isSubagentSession(): boolean { return Boolean(this.permissionParent); }
  isSideConversation(): boolean { return Boolean(this.sideChatMeta); }
  getSideChatParentId(): string | undefined { return this.sideChatMeta?.parentSessionId; }
  getSideChatMeta(): SideChatMetaEntry | undefined { return this.sideChatMeta; }
  refreshToolApprovals(): void { this.permissions.refreshToolApprovals(); }

  notifySubagentChanged(record: SubagentRecord): void {
    this.emit({
      type: "subagent_update",
      parentSessionId: record.parentSessionId,
      agentId: record.agentId,
      background: record.background,
      status: record.status,
      attempt: record.attempt ?? 1,
      revision: record.revision ?? 0,
    });
    scheduleRunningChange();
  }

  isRunning(): boolean {
    return this._alive && this.getRuntime() !== "idle";
  }

  async executeChatCommand(commandId: string, message: string, onPhase: (phase: ChatCommandPhase) => void = () => {}, activity?: { execute(): Promise<void>; source?: SessionMessageSourceKind }): Promise<void> {
    assertRemotePolicyCommand(this.remotePolicy, { type: "prompt", message });
    await this.waitForExtensionsBound();
    if (!this._alive || this.stopping) throw new Error("Command cancelled");
    this.assertWorkflowExtensionCommand(message);
    const abortGeneration = this.abortGeneration;
    this.permissions.reviews().admit({ id: commandId, source: activity?.source ?? "unknown", text: message, timestamp: Date.now() }, !this.activePromptRun);
    if (!this.activePromptRun) this.permissions.setReviewModel(this.inner.model ? { provider: this.inner.model.provider, id: this.inner.model.id } : undefined);
    let ownedRun: PromptRunIdentity | undefined;
    let fileChangeCapture: ReturnType<typeof beginPromptFileChanges> | undefined;
    let failed = false;
    this.inputAdmissions++;
    notifyRunningChange();
    const execution = this.chatCommandActivities.run(commandId, activity?.execute ?? (() => this.inner.prompt(message, { source: "rpc", streamingBehavior: "steer" })), {
      onPhase: phase => {
        if (phase === "model" && !this.activePromptRun) {
          this.activity.beginRun("prompt", compactTaskActivityText(message) || "Extension request", "waiting_model");
          this.lastPromptFailed = false;
          this.lastPromptErrorSummary = undefined;
          ownedRun = beginPromptRun(this.sessionId, { source: activity?.source ?? "ui" });
          this.activePromptRun = ownedRun;
          this.activeCommandId = commandId;
          fileChangeCapture = beginPromptFileChanges(ownedRun, this.cwd);
          this.emit({ type: "prompt_started", sessionId: this.sessionId, commandId, runId: ownedRun.runId, timestamp: Date.now() });
        }
        onPhase(phase);
      },
      assertActive: () => {
        if (!this._alive || this.stopping || abortGeneration !== this.abortGeneration) throw new Error("Command cancelled");
      },
      waitForIdle: async () => {
        if (!this.chatCommandActivities.hasModelWork) return;
        await this.inner.waitForIdle?.();
        const response = this.lastAssistantResponse as { stopReason?: string; errorMessage?: string } | undefined;
        if (response?.stopReason === "error" || response?.stopReason === "aborted") throw new Error(response.errorMessage || `Command model ${response.stopReason}`);
      },
    });
    const writer = execution.then(() => undefined, () => undefined);
    this.promptTasks.add(writer);
    try { await execution; }
    catch (error) { failed = true; throw error; }
    finally {
      try {
        if (ownedRun) {
          const cancelled = abortGeneration !== this.abortGeneration || !this._alive;
          try {
            if (fileChangeCapture) await finishPromptFileChanges(fileChangeCapture, cancelled ? "aborted" : failed ? "error" : "complete");
            await finishPromptRun(ownedRun, cancelled ? "abort" : failed ? "error" : "idle");
          } finally {
            if (this.activePromptRun?.runId === ownedRun.runId) this.activePromptRun = undefined;
            if (this.activeCommandId === commandId) this.activeCommandId = undefined;
            this.emit({ type: failed ? "prompt_error" : "prompt_done", sessionId: this.sessionId, commandId, runId: ownedRun.runId, timestamp: Date.now(), aborted: cancelled });
          }
        }
      } finally {
        this.promptTasks.delete(writer);
        this.inputAdmissions--;
        this.emit({ type: "session_idle", commandId });
        notifyRunningChange();
      }
    }
  }

  async executeModelCommand(commandId: string, message: string, options: {
    delivery: "steer" | "followUp";
    images?: Array<{ type: "image"; data: string; mimeType: string }>;
    materials?: PromptMaterialReference[];
    promptSuffix?: string;
  }, onPhase: (phase: ChatCommandPhase) => void): Promise<void> {
    const materials = options.materials?.length ? resolvePromptMaterialReferences(options.materials) : [];
    await this.executeChatCommand(commandId, message, onPhase, {
      execute: () => this.promptInputEnrichment.run(text => {
        const enriched = options.promptSuffix ? `${text}\n\n${options.promptSuffix}` : text;
        return materials.length ? buildPromptWithMaterials(enriched, materials) : enriched;
      }, () => this.inner.prompt(message, { source: "rpc", streamingBehavior: options.delivery, ...(options.images?.length ? { images: options.images } : {}) })),
    });
  }

  getRemoteContentSnapshot() {
    const runId = this.activePromptRun?.runId ?? null;
    this.remoteContent.resetForRun(runId);
    const snapshot = this.remoteContent.snapshot();
    return { ...snapshot, sessionId: this.sessionId, runId, running: runId !== null };
  }

  isToolAllowedByCapability(name: string): boolean { return this.capabilities.isToolAllowedByCapability(name); }
  isMcpResourceServerAllowed(server: string): boolean { return this.capabilities.isMcpResourceServerAllowed(server); }
  refreshNativeMcpCapabilities(): void { this.capabilities.refreshNativeMcpCapabilities(); }
  getSessionCapabilities(): SessionCapabilitiesState { return this.capabilities.getSessionCapabilities(); }
  initializeSessionCapabilities(): void { this.capabilities.initializeSessionCapabilities(); }
  applyProjectCapabilitySettings(record: ProjectToolSettingsRecord): "applied" | "deferred" {
    return this.capabilities.applyProjectCapabilitySettings(record);
  }

  requestSystemPromptReload(): Promise<"reloaded" | "deferred" | "skipped"> {
    return this.systemPromptReloader.requestReload();
  }

  getSystemPromptBinding(): SessionSystemPromptBinding | null {
    return this.systemPromptReloader.getBinding();
  }

  setSystemPromptBinding(selection: SystemPromptSelection): Promise<SessionSystemPromptBinding> {
    return this.systemPromptReloader.setBinding(selection);
  }

  getActivePromptRunId(): string | undefined {
    return this.activePromptRun?.runId;
  }

  /** Start one ordinary prompt with a stable command correlation id. */
  async startTrackedPrompt(input: {
    workflow?: WorkflowPromptOptions;
    workflowAction?: WorkflowAction;
    promptSuffix?: string;
    inputMode?: "text";
    commandId: string;
    clientPromptId?: string;
    source: SessionMessageSourceKind;
    roomContext?: SessionRoomContext;
    message: string;
    images?: Array<{ type: "image"; data: string; mimeType: string }>;
    materials?: PromptMaterialReference[];
    teamExecution?: TeamExecutionContext;
  }): Promise<{ accepted: true; sessionId: string; commandId: string; runId: string }> {
    if (input.teamExecution) this.validateTeamRuntimePolicy(input.teamExecution);
    // Keep even a first-send/auth failure discoverable after server restart.
    if (input.source === "ui") this.persistSessionFile();
    await this.send({ type: "prompt", ...input });
    const runId = this.activePromptRun?.runId;
    if (!runId) throw new Error("Prompt was not admitted by the target session.");
    return { accepted: true, sessionId: this.sessionId, commandId: input.commandId, runId };
  }

  private validateTeamRuntimePolicy(context: TeamExecutionContext): void {
    validateTeamExecutionContext(context, this.sessionId);
    const member = getRoom(context.roomId).members.find((candidate) => candidate.memberId === context.memberId)!;
    if (member.binding.cwd) {
      const normalize = (value: string) => process.platform === "win32" ? resolve(value).toLocaleLowerCase() : resolve(value);
      if (normalize(member.binding.cwd) !== normalize(this.cwd)) throw new TeamError("TEAM_WORKSPACE_CONFLICT", "Team Agent Session cwd does not match its workspace binding.");
    }
    if (member.profile.modelPolicy.mode === "pinned") {
      const model = this.inner.model;
      if (!model || model.provider !== member.profile.modelPolicy.provider || model.id !== member.profile.modelPolicy.modelId) {
        throw new TeamError("TEAM_INVALID_CONTEXT", "Managed Team Agent model drifted from its pinned Profile.");
      }
    }
    if (member.profile.toolPolicy.mode === "allowlist") {
      const expected = [...new Set([...member.profile.toolPolicy.toolNames, "piora_room"])].sort();
      const actual = [...this.inner.getActiveToolNames()].sort();
      if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
        throw new TeamError("TEAM_INVALID_CONTEXT", "Managed Team Agent tools drifted from its Profile allowlist.");
      }
    }
  }

  private getForegroundRuntime(): Runtime {
    if (!this._alive) return "idle";
    if (this.stopping) return "stopping";
    if (this.inner.isCompacting) return "compacting";
    if (this.inputAdmissions || this.promptAdmissionBusy || this.promptRunning || this.inner.isStreaming || this.inner.isBashRunning) return "running";
    return "idle";
  }

  isForegroundRunning(): boolean { return this.getForegroundRuntime() !== "idle"; }

  getRuntime(): Runtime {
    if (!this._alive) return "idle";
    const foreground = this.getForegroundRuntime();
    return foreground === "idle" && this.subagents?.running ? "running" : foreground;
  }

  getTaskRuntimeSnapshot(): TaskRuntimeSnapshot {
    let activeGoal = false;
    let awaitingPlanApproval = false;
    if (this.runtimeProfile === "normal") {
      try {
        const wf = readWorkflowSnapshot(this.sessionId);
        activeGoal = Boolean(
          wf.current?.kind === "goal"
          && ["running", "waiting", "paused", "budget_exhausted"].includes(wf.current.status),
        );
        awaitingPlanApproval = Boolean(
          wf.current?.kind === "plan"
          && wf.current.status === "awaiting_approval",
        );
      } catch {
        // Corrupt workflow JSON must never break task list snapshots.
      }
    }
    return this.activity.buildTaskRuntimeSnapshot({
      sessionId: this.sessionId,
      runtime: this.getRuntime(),
      pendingApproval: this.uiBridge.hasPendingApproval(),
      lastPromptFailed: this.lastPromptFailed,
      lastPromptErrorSummary: this.lastPromptErrorSummary,
      cachedSessionTitle: this.cachedSessionTitle,
      fallbackTaskTitle: this.fallbackTaskTitle,
      contextUsage: this.inner.getContextUsage(),
      runningSubagentCount: this.subagents?.activeCount,
      activeGoal,
      awaitingPlanApproval,
    });
  }

  setSessionName(name: string): void {
    this.inner.setSessionName(name);
    this.cachedSessionTitle = name.trim() || null;
    notifyRunningChange();
  }

  maybeAutoTitleSideChat(message: string, hasImages: boolean): void {
    if (!this.sideChatMeta) return;
    const current = this.cachedSessionTitle ?? this.inner.sessionManager.getSessionName()?.trim() ?? null;
    if (!isDefaultSideChatTitle(current)) return;
    const derived = deriveSideChatAutoTitle(message, hasImages);
    if (!derived) return;
    this.setSessionName(derived);
  }

  start(): void {
    if (!this.permissionParent && !this.sideChatMeta && this.runtimeProfile === "normal" && this.remotePolicy !== "notes") {
      if (!registeredSessionStarter) throw new Error("RPC session starter is not registered.");
      this.subagents = new SubagentRuntime(this.sessionId, this.cwd, createSubagentDriver(this, registeredSessionStarter));
      this.onDestroy(bindSubagentRuntime(this.subagents));
    }
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      if (event.type === "tool_execution_end" && typeof event.toolCallId === "string") {
        this.permissions.finishToolCall(event.toolCallId, event.isError === true);
      }
      // Pi 1.0 emits structured system/loadout messages as transcript events.
      // They remain canonical SDK/provider history but are not chat rows or
      // streaming assistant content, matching session-reader's projection.
      if ((event.type === "message_start" || event.type === "message_update" || event.type === "message_end")
        && (event.message as { role?: string } | undefined)?.role === "system") return;
      this.streamingMetrics.update(event);
      this.remoteContent.update(event);
      if (event.type === "message_start" && (event.message as { role?: string } | undefined)?.role === "user") {
        this.promptInputEnrichment.apply(event.message as { content?: unknown });
      }
      if (event.type === "message_end" && event.message && typeof event.message === "object") {
        this.queueTracker.consumeReceiptForMessage(event.message);
      }
      if (event.type === "message_end" && (event.message as { role?: string } | undefined)?.role === "user" && this.pendingClientPromptId) {
        // The SDK emits this event before appending the same object to its
        // SessionManager. Persist the receipt alongside the actual user text.
        (event.message as { clientPromptId?: string }).clientPromptId = this.pendingClientPromptId;
        this.pendingClientPromptId = undefined;
      }
      this.resetIdleTimer();
      this.activity.updateActivityFromEvent(event);
      this.activity.updateStatusPhase(event, this.inner, this.stopping, this.promptRunning);
      if (event.type === "message_end" && (event.message as { role?: string } | undefined)?.role === "assistant") {
        this.lastAssistantResponse = event.message;
      }
      if (event.type === "tool_execution_start") {
        const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
        const toolName = typeof event.toolName === "string" ? event.toolName : "";
        if (toolCallId && toolName) {
          this.runtimeToolCalls.set(toolCallId, { toolName, args: event.args });
        }
      }
      if (event.type === "tool_execution_update") {
        const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
        const started = toolCallId ? this.runtimeToolCalls.get(toolCallId) : undefined;
        const partial = event.partialResult as { details?: unknown } | undefined;
        if (started && partial?.details && typeof partial.details === "object" && !Array.isArray(partial.details)) {
          started.outputDetails = { ...started.outputDetails, ...(partial.details as Record<string, unknown>) };
        }
      }
      if (event.type === "tool_execution_end") {
        const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
        const started = toolCallId ? this.runtimeToolCalls.get(toolCallId) : undefined;
        const toolName = started?.toolName ?? (typeof event.toolName === "string" ? event.toolName : "");
        // Shell tools can throw after producing a truncated output snapshot. Pi's
        // error conversion keeps the text but replaces details with {}, so merge
        // the last streamed metadata back before the toolResult is persisted.
        if (started?.outputDetails && event.result && typeof event.result === "object") {
          const result = event.result as { details?: unknown };
          result.details = mergeCommandOutputDetails(toolName, started.outputDetails, result.details);
        }
        if (toolCallId) this.runtimeToolCalls.delete(toolCallId);
        if (this.activePromptRun && toolCallId && toolName) {
          void captureTeamRuntimeToolResult(
            this.activePromptRun,
            toolCallId,
            toolName,
            started?.args ?? event.args,
            event.isError === true,
          ).catch((error) => console.error("[pi-web] failed to capture Team runtime evidence:", error instanceof Error ? error.message : String(error)));
        }
      }
      if (event.type === "agent_start") {
        this.lastPromptFailed = false;
        this.lastPromptErrorSummary = undefined;
      }
      if (event.type === "agent_end") {
        this.runtimeToolCalls.clear();
        invalidateSessionListCache();
      }
      // Cancelled transport events may arrive while the next prompt is already
      // waiting in the router inbox. They must not paint as that new prompt.
      if (!this.stopping) {
        const message = event.type === "message_start" || event.type === "message_update"
          ? this.streamingMetrics.getMessage() : null;
        this.emit(message && (event.message as { role?: string } | undefined)?.role === "assistant"
          ? { ...event, message } : event);
      }
      // Lifecycle state is immediate; high-frequency text/tool activity is
      // coalesced so a token stream cannot rebuild every live-session snapshot.
      if (isImmediateRunningSnapshotEvent(event)) notifyRunningChange();
      else scheduleRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.systemPromptReloader.setForceEmptySystemPrompt(force);
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((err) => {
      console.error("[pi-web] failed to dispatch session_start to extensions:", err instanceof Error ? err.message : err);
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.waitForExtensionsBound();
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.systemPromptReloader.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.systemPromptReloader.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.uiBridge.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.uiBridge.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in Pi Web.",
          } as ExtensionUiRequest as AgentEvent),
          onError: (error) => {
            this.chatCommandActivities.fail(new Error(error.error));
            this.emit({
              type: "extension_error",
              commandId: this.chatCommandActivities.commandId,
              extensionPath: error.extensionPath,
              event: error.event,
              error: error.error,
            });
          },
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.capabilities.reapplySessionCapabilities();
      console.log(`[pi-web] session_start dispatched to extensions for session ${this.inner.sessionId}`);
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands" || type === "workflow_configure" || type === "workflow_action";
  }

  private observeWorkflow() {
    const workflow = getWorkflowRuntime(this.sessionId);
    if (!this.unsubscribeWorkflow) this.unsubscribeWorkflow = workflow.subscribe(snapshot => {
      if (this._alive) this.emit({ type: "workflow_update", sessionId: this.sessionId, snapshot });
    });
    return workflow;
  }

  private assertWorkflowSession(): void {
    if (
      this.runtimeProfile !== "normal"
      || this.remotePolicy === "notes"
      || this.isSideConversation()
      || listRooms(this.sessionId).some(room => room.members.some(member => member.binding.sessionId === this.sessionId))
    ) {
      throw new WorkflowError("Workflow modes are unavailable here.", "WORKFLOW_UNAVAILABLE", 403);
    }
  }

  private assertWorkflowExtensionCommand(message: string, inputMode?: unknown, mode = readWorkflowSnapshot(this.sessionId).mode): void {
    if (mode === "agent" || inputMode === "text") return;
    const invocation = message.trimStart().match(/^\/([^\s]+)/)?.[1];
    if (invocation && this.inner.extensionRunner.getRegisteredCommands().some(command => command.invocationName === invocation)) {
      throw new WorkflowError("Switch to Agent mode before running an extension command.", "WORKFLOW_EXTENSION_COMMAND", 409);
    }
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      notifyRunningChange();
    }
  }

  private emit(event: AgentEvent): void {
    if (event.type === "queue_update") {
      // SDK emits its labels before enqueueing the actual message. Read both
      // together after that synchronous operation, never publish a partial list.
      queueMicrotask(() => {
        if (!this._alive) return;
        const update = { type: "queue_update", steering: [...this.inner.getSteeringMessages()], followUp: [...this.inner.getFollowUpMessages()], pendingInputs: this.getPendingInputs() };
        for (const listener of this.listeners) listener(update);
      });
      return;
    }
    if (isRunProgressEvent(event.type)) this.activity.markProgress();
    if (event.type === "compaction_start" || event.type === "auto_compaction_start") {
      event = { ...event, compactionStartedAt: this.activity.compactionStartedAt };
    }
    recordAgentTerminalEvent(this.sessionId, event);
    for (const l of this.listeners) l(event);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.isRunning()) {
        this.resetIdleTimer();
        return;
      }
      this.destroy();
    }, 10 * 60 * 1000);
  }

  persistSessionFile(): void {
    const manager = this.inner.sessionManager;
    const sessionFile = persistLazySessionManager(manager);
    if (sessionFile) cacheSessionPath(this.inner.sessionId, sessionFile);
  }

  appendAutomationCard(details: Record<string, unknown>): void {
    this.persistSessionFile();
    this.inner.sessionManager.appendCustomMessageEntry("piora-automation", "", true, details);
    invalidateSessionListCache();
  }

  private assertSessionIdle(action: string): void {
    if (this.stopping || this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning) {
      throw new Error(`Cannot ${action} while the session is busy`);
    }
  }

  getPendingUiRequests(): ExtensionUiRequest[] {
    return this.uiBridge.getPendingUiRequests();
  }

  private get pendingUiRequests() { return this.uiBridge.pendingUiRequests; }
  private get pendingUiResponses() { return this.uiBridge.pendingUiResponses; }
  private requestExtensionUi<T>(...args: Parameters<ExtensionUiBridge["requestExtensionUi"]>): Promise<T> {
    return this.uiBridge.requestExtensionUi(...args) as Promise<T>;
  }
  private createExtensionUiContext(): ExtensionUiContextLike {
    return this.uiBridge.createExtensionUiContext();
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const review of this.permissions.reviews().list()) listener({ type: "tool_review", review });
    this.uiBridge.replayPendingRequests(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  getStreamingMessage() {
    return !this._alive || this.stopping ? null : this.streamingMetrics.getMessage();
  }

  getStreamingMetrics() {
    return !this._alive || this.stopping ? null : this.streamingMetrics.getMetrics();
  }

  onDestroy(cb: () => void): () => void {
    this.onDestroyCallbacks.add(cb);
    return () => this.onDestroyCallbacks.delete(cb);
  }

  getRuntimeState(view: SessionRuntimeStateView = "full") {
    const runtime = this.getForegroundRuntime();
    const progress = {
      sessionId: this.sessionId,
      runtime,
      isStreaming: this.inner.isStreaming,
      isPromptRunning: this.promptRunning,
      isBashRunning: this.inner.isBashRunning,
      runStartedAt: runtime === "idle" ? null : this.activity.runStartedAt,
      statusPhaseKind: runtime === "idle" ? null : this.activity.statusPhaseKind,
      statusPhaseStartedAt: runtime === "idle" ? null : this.activity.statusPhaseStartedAt,
      lastProgressAt: runtime === "idle" ? null : this.activity.lastProgressAt,
      isCompacting: this.inner.isCompacting,
      compactionStartedAt: this.inner.isCompacting ? this.activity.compactionStartedAt : null,
    };
    if (view === "progress") return progress;

    const model = this.inner.model;
    return {
      ...progress,
      subagents: this.subagents?.list().map(projectSubagentDetail) ?? [],
      subagentsRunning: this.subagents?.running ?? false,
      ...(this.runtimeProfile === "normal" ? { workflow: readWorkflowSnapshot(this.sessionId) } : {}),
      ...(view === "full" ? { stats: summarizeLiveSessionStats(this.inner.sessionManager) } : {}),
      runtimeProfile: this.runtimeProfile,
      remotePolicy: this.remotePolicy,
      sessionFile: this.inner.sessionFile ?? "",
      activeTools: Array.from(this.runtimeToolCalls, ([id, tool]) => ({ id, name: tool.toolName })),
      pendingApproval: this.uiBridge.hasPendingApproval(),
      lastPromptFailed: this.lastPromptFailed,
      lastPromptErrorSummary: this.lastPromptErrorSummary,
      autoCompactionEnabled: this.inner.autoCompactionEnabled,
      autoRetryEnabled: this.inner.autoRetryEnabled,
      model: model ? { id: model.id, provider: model.provider } : undefined,
      messageCount: 0,
      pendingMessageCount: this.inner.pendingMessageCount,
      queuedMessages: {
        pendingInputs: this.getPendingInputs(),
        steering: [...this.inner.getSteeringMessages()],
        followUp: [...this.inner.getFollowUpMessages()],
      },
      ...projectRuntimeContext(this.inner, this.systemPromptReloader.forceEmptySystemPrompt),
      systemPromptBinding: view === "full" ? this.getSystemPromptBinding() : summarizeSessionSystemPromptBinding(this.getSystemPromptBinding()),
      thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
      extensionStatuses: this.uiBridge.getExtensionStatuses(),
      extensionWidgets: this.uiBridge.getExtensionWidgets(),
      capabilities: this.getSessionCapabilities(),
      toolPermission: this.permissions.getToolPermission(),
      ...(view === "full" ? { toolReviews: this.permissions.reviews().list() } : {}),
    };
  }

  /** Pure in-memory runtime snapshot for initial SSE connect/reconnect frames. */
  getStreamConnectState() {
    return {
      ...this.getRuntimeState("progress"),
      activeTools: Array.from(this.runtimeToolCalls, ([id, tool]) => ({ id, name: tool.toolName })),
      pendingApproval: this.uiBridge.hasPendingApproval(),
      queuedMessages: {
        pendingInputs: this.getPendingInputs(),
        steering: [...this.inner.getSteeringMessages()],
        followUp: [...this.inner.getFollowUpMessages()],
      },
    };
  }

  private static buildCommandHost(wrapper: AgentSessionWrapper): RpcCommandHost {
    return {
      get inner() { return wrapper.inner; },
      get sessionId() { return wrapper.sessionId; },
      get cwd() { return wrapper.cwd; },
      get runtimeProfile() { return wrapper.runtimeProfile; },
      get uiBridge() { return wrapper.uiBridge; },
      get permissions() { return wrapper.permissions; },
      get capabilities() { return wrapper.capabilities; },
      get promptTasks() { return wrapper.promptTasks; },
      get promptInputEnrichment() { return wrapper.promptInputEnrichment; },
      get queueSource() { return wrapper.queueTracker.queueSource; },
      get queuedInputReceipts() { return wrapper.queueTracker.queuedInputReceipts; },
      get subagents() { return wrapper.subagents; },
      get hasPermissionParent() { return Boolean(wrapper.permissionParent); },
      get lastAssistantResponse() { return wrapper.lastAssistantResponse; },
      get cachedSessionTitle() { return wrapper.cachedSessionTitle; },
      get forceEmptySystemPrompt() { return wrapper.systemPromptReloader.forceEmptySystemPrompt; },

      get stopping() { return wrapper.stopping; },
      set stopping(value) { wrapper.stopping = value; },
      get abortGeneration() { return wrapper.abortGeneration; },
      set abortGeneration(value) { wrapper.abortGeneration = value; },
      get promptRunning() { return wrapper.promptRunning; },
      set promptRunning(value) { wrapper.promptRunning = value; },
      get promptAdmissionBusy() { return wrapper.promptAdmissionBusy; },
      set promptAdmissionBusy(value) { wrapper.promptAdmissionBusy = value; },
      get pendingClientPromptId() { return wrapper.pendingClientPromptId; },
      set pendingClientPromptId(value) { wrapper.pendingClientPromptId = value; },
      get lastPromptFailed() { return wrapper.lastPromptFailed; },
      set lastPromptFailed(value) { wrapper.lastPromptFailed = value; },
      get lastPromptErrorSummary() { return wrapper.lastPromptErrorSummary; },
      set lastPromptErrorSummary(value) { wrapper.lastPromptErrorSummary = value; },
      get fallbackTaskTitle() { return wrapper.fallbackTaskTitle; },
      set fallbackTaskTitle(value) { wrapper.fallbackTaskTitle = value; },
      get activePromptRun() { return wrapper.activePromptRun; },
      set activePromptRun(value) { wrapper.activePromptRun = value; },
      get activeCommandId() { return wrapper.activeCommandId; },
      set activeCommandId(value) { wrapper.activeCommandId = value; },
      get abortedQueuedMessages() { return wrapper.abortedQueuedMessages; },
      set abortedQueuedMessages(value) { wrapper.abortedQueuedMessages = value; },
      get abortCleanupTask() { return wrapper.abortCleanupTask; },
      set abortCleanupTask(value) { wrapper.abortCleanupTask = value; },
      get stoppedInputRecovery() { return wrapper.stoppedInputRecovery; },
      set stoppedInputRecovery(value) { wrapper.stoppedInputRecovery = value; },
      get inputAdmissions() { return wrapper.inputAdmissions; },
      set inputAdmissions(value) { wrapper.inputAdmissions = value; },
      get statusPhaseKind() { return wrapper.activity.statusPhaseKind; },
      set statusPhaseKind(value) { wrapper.activity.statusPhaseKind = value; },
      get statusPhaseStartedAt() { return wrapper.activity.statusPhaseStartedAt; },
      set statusPhaseStartedAt(value) { wrapper.activity.statusPhaseStartedAt = value; },

      isAlive: () => wrapper._alive,
      isRunning: () => wrapper.isRunning(),
      getRuntime: () => wrapper.getRuntime(),
      abortSubagentUi: () => wrapper.subagentUiController.abort(),
      emit: (event) => wrapper.emit(event),
      send: (command) => wrapper.send(command),
      destroy: () => wrapper.destroy(),
      assertSessionIdle: (action) => wrapper.assertSessionIdle(action),
      assertWorkflowSession: () => wrapper.assertWorkflowSession(),
      assertWorkflowExtensionCommand: (message, inputMode, mode) => wrapper.assertWorkflowExtensionCommand(message, inputMode, mode),
      observeWorkflow: () => wrapper.observeWorkflow(),
      validateTeamRuntimePolicy: (context) => wrapper.validateTeamRuntimePolicy(context),
      beginRun: (kind, message, phaseKind) => wrapper.activity.beginRun(kind, message, phaseKind),
      setTaskActivity: (kind, message, streaming) => wrapper.activity.setTaskActivity(kind, message, streaming),
      withFinalRunningNotification: (operation) => wrapper.withFinalRunningNotification(operation),
      persistSessionFile: () => wrapper.persistSessionFile(),
      getSystemPromptBinding: () => wrapper.getSystemPromptBinding(),
      getActivePromptRunId: () => wrapper.getActivePromptRunId(),
      executeChatCommand: (commandId, message) => wrapper.executeChatCommand(commandId, message),
      waitForExtensionsBound: () => wrapper.waitForExtensionsBound(),
      setSessionName: (name) => wrapper.setSessionName(name),
      maybeAutoTitleSideChat: (message, hasImages) => wrapper.maybeAutoTitleSideChat(message, hasImages),
      getRuntimeState: (view) => wrapper.getRuntimeState(view),
    };
  }

  async send(command: SessionRpcCommand): Promise<unknown> {
    const type = authorizeSessionCommand(this.sessionId, this.remotePolicy, command);
    this.resetIdleTimer();
    this.capabilities.flushPendingProjectCapabilitySettings();
    const abortGeneration = this.abortGeneration;
    enforceCommandProfile(type, this.runtimeProfile, DEVICE_CONTROL_DENIED_RPC_COMMANDS);
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();
    recheckCommandSession(type, this.sessionId, this._alive);

    const host = AgentSessionWrapper.buildCommandHost(this);
    if (type === "prompt" || type === "steer" || type === "follow_up") {
      const preflight = preflightPromptOrQueueCommand(host, type, command, abortGeneration);
      if (preflight) await preflight;
    }

    switch (type) {
      case "workflow_configure": return handleWorkflowConfigureCommand(host, command);
      case "workflow_action": return handleWorkflowActionCommand(host, command);
      case "workflow_save_plan": return handleWorkflowSavePlanCommand(host, command);
      case "user_input_presence":
        this.uiBridge.setUserInputPresented(command.presented !== false);
        return null;
      case "user_input_activity":
        this.uiBridge.recordUserInputActivity(typeof command.id === "string" ? command.id : undefined);
        return null;
      case "prompt": return handlePromptCommand(host, command, abortGeneration);
      case "abort": return handleAbortCommand(host);
      case "get_state": return this.getRuntimeState(parseRuntimeStateView(command.view));
      case "set_model": return handleSetModelCommand(host, command);
      case "fork": return handleForkCommand(host, command);
      case "navigate_tree": return handleNavigateTreeCommand(host, command);
      case "set_thinking_level": return handleSetThinkingLevelCommand(host, command);
      case "compact": return handleCompactCommand(host, command);
      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.setSessionName(name);
        invalidateSessionListCache();
        return null;
      }
      case "get_session_stats": return handleGetSessionStatsCommand(host);
      case "get_last_assistant_text": return { text: this.inner.getLastAssistantText() ?? "" };
      case "set_auto_compaction":
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      case "steer":
      case "follow_up":
        return handleQueueCommand(host, type, command, abortGeneration);
      case "get_tools": return this.capabilities.getToolsSummary();
      case "get_capabilities": return this.getSessionCapabilities();
      case "get_commands": return handleGetCommandsCommand(host);
      case "set_tools": return this.capabilities.setTools(command.toolNames);
      case "set_capabilities": return this.capabilities.setCapabilities(command);
      case "set_team_tools": return this.capabilities.setTeamTools(command.toolNames);
      case "reload": return handleReloadCommand(host);
      case "restart_extensions":
        this.assertSessionIdle("restart extensions");
        this.destroy();
        return { success: true };
      case "abort_compaction": return handleAbortCompactionCommand(host);
      case "extension_ui_response":
        this.uiBridge.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      case "get_tool_permission": return this.permissions.getToolPermission();
      case "set_tool_permission": return this.permissions.setToolPermission(command.mode, command.rememberDefault);
      case "extension_ui_input":
        this.uiBridge.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      case "set_auto_retry":
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      case "bash": return handleBashCommand(host, command);
      case "abort_bash": return handleAbortBashCommand(host);
      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  /** File mutations must wait for writers and extension shutdown to finish. */
  async shutdownForFileMutation(): Promise<void> {
    if (this._alive) {
      await this.extensionBindingPromise?.catch(() => undefined);
      await this.send({ type: "abort" });
      await this.abortCleanupTask;
      this.destroy();
    }
    await this.shutdownTask;
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    this.subagentUiController.abort();
    findWorkflowRuntime(this.sessionId)?.dispose();
    this.unsubscribeWorkflow?.();
    this.permissions.cancel();
    const writers: Promise<unknown>[] = [this.abortCleanupTask, ...this.promptTasks];
    if (this.subagents) writers.push(this.subagents.dispose());
    if (this.promptRunning || this.inner.isStreaming) {
      writers.push(this.inner.abort());
    }
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.systemPromptReloader.dispose();
    if (this.inner.isBashRunning) writers.push(Promise.resolve(this.inner.abortBash()));
    const promptRun = this.activePromptRun;
    this.activePromptRun = undefined;
    this.activeCommandId = undefined;
    this.promptAdmissionBusy = false;
    writers.push(finishPromptRun(promptRun, "destroy"));
    this.unsubscribe?.();
    this.uiBridge.cancelAllForDestroy();
    this.runtimeToolCalls.clear();
    for (const callback of this.onDestroyCallbacks) {
      try { callback(); } catch (error) {
        console.error("[pi-web] session destroy callback failed:", error instanceof Error ? error.message : error);
      }
    }
    this.onDestroyCallbacks.clear();
    // AgentSession.dispose() is synchronous in the SDK, but extension
    // session_shutdown handlers are async. Run the lifecycle in order so a
    // session's handlers finish before its runner is invalidated and disposed.
    this.shutdownTask = trackSessionFileOperation(this.sessionId, (async () => {
      await Promise.allSettled(writers);
      try {
        await this.inner.extensionRunner.emit?.({ type: "session_shutdown", reason: "shutdown" });
      } catch (error) {
        console.error("[pi-web] session_shutdown handler failed:", error instanceof Error ? error.message : error);
      } finally {
        try { this.inner.dispose?.(); } catch (error) {
          console.error("[pi-web] AgentSession dispose failed:", error instanceof Error ? error.message : error);
        }
      }
    })());
    notifyRunningChange();
  }
}
