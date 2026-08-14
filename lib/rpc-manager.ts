import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, initTheme, SessionManager, Theme, type AgentSessionServices } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { existsSync, realpathSync, writeFileSync } from "fs";
import { resolve } from "path";
import { validateAgentImages } from "./image-attachments";
import { invalidateModelsCache } from "./models-cache";
import { resolveVisibleModels, selectInitialModelScope } from "./model-scope";
import { resolveDefaultModelPreference } from "./model-policy";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";
import { ensureWindowsBashShellPath } from "./windows-bash";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "./pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "./types";
import { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS } from "./custom-ui-terminal";
import type { Runtime, TaskRuntimeActivity, TaskRuntimeActivityKind, TaskRuntimeSnapshot } from "./task-status";
import {
  assertCurrentAgentRuntimeProfile,
  getAgentRuntimeProfile,
  type AgentRuntimeProfile,
} from "./agent-runtime-profile";
import {
  bindSessionAgentRuntimeProfile,
  quarantineUnboundSessionFile,
  readAgentProfileStore,
  resolveSessionAgentRuntimeProfile,
} from "./agent-profile-store";
import {
  beginPromptRun,
  finishPromptRun,
  type PromptRunIdentity,
} from "./prompt-run-registry";
import {
  advanceGoalIteration,
  beginGoalRun,
  forceBlockGoal,
  getGoalRun,
  type GoalRunState,
} from "./goal-run-registry";
import {
  DEVICE_CONTROL_AGENT_TOOLS,
  resolveAgentToolsForRuntimeProfile,
} from "./tool-presets";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

export interface RpcSessionStartOptions {
  toolNames?: string[];
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
  runtimeProfile?: AgentRuntimeProfile;
}

const CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const TASK_ACTIVITY_MAX_LENGTH = 240;
const TASK_ACTIVITY_STREAM_INTERVAL_MS = 300;
const GOAL_MODE_MAX_CONTINUATIONS = 64;
const GOAL_MODE_CONTINUATION = [
  "Piora target mode is still active. Continue working toward the original user objective now.",
  "Inspect current evidence and take the next useful action. Do not stop merely because this model turn can end.",
  "Use piora_goal progress after material milestones, complete only after verifying the outcome, or blocked only when an external change or user input is genuinely required.",
].join(" ");

function compactTaskActivityText(value: unknown, maxLength = TASK_ACTIVITY_MAX_LENGTH): string {
  const text = typeof value === "string" ? value : (() => {
    try { return JSON.stringify(value); } catch { return String(value ?? ""); }
  })();
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `…${compact.slice(-(maxLength - 1))}`;
}

function activityFromMessage(message: unknown): Pick<TaskRuntimeActivity, "kind" | "message"> | null {
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    const text = compactTaskActivityText(content);
    return text ? { kind: "assistant", message: text } : null;
  }
  if (!Array.isArray(content)) return null;
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index];
    if (!block || typeof block !== "object") continue;
    const candidate = block as Record<string, unknown>;
    if (candidate.type === "toolCall") {
      const name = compactTaskActivityText(candidate.toolName ?? candidate.name, 64);
      const input = compactTaskActivityText(candidate.input ?? candidate.arguments, 160);
      const detail = [name, input].filter(Boolean).join(": ");
      if (detail) return { kind: "tool", message: detail };
    }
    if (candidate.type === "text") {
      const text = compactTaskActivityText(candidate.text);
      if (text) return { kind: "assistant", message: text };
    }
    if (candidate.type === "thinking") {
      const thinking = compactTaskActivityText(candidate.thinking);
      if (thinking) return { kind: "thinking", message: thinking };
    }
  }
  return null;
}

// Extensions require a complete Theme, while the web UI applies its own styling.
class PlainTextTheme extends Theme {
  constructor() {
    super(
      { thinkingXhigh: "" } as ConstructorParameters<typeof Theme>[0],
      {} as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
  override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
  override bold(text: string): string { return text; }
  override italic(text: string): string { return text; }
  override underline(text: string): string { return text; }
  override inverse(text: string): string { return text; }
  override strikethrough(text: string): string { return text; }
  override getFgAnsi(): string { return ""; }
  override getBgAnsi(): string { return ""; }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string { return (text) => text; }
}

const PLAIN_TEXT_THEME = new PlainTextTheme();
const CUSTOM_UI_KEYBINDINGS = new TuiKeybindingsManager(TUI_KEYBINDINGS);

function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const extensionToolNames = session
    .getAllTools()
    .map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));

  return [...new Set([...toolNames, ...extensionToolNames])];
}

const DEVICE_CONTROL_DENIED_RPC_COMMANDS = new Set(["bash", "abort_bash"]);

function activeToolsForProfile(
  session: AgentSessionLike,
  runtimeProfile: AgentRuntimeProfile,
  requestedToolNames: readonly string[],
): string[] {
  if (runtimeProfile === "device-control") {
    return requestedToolNames.length === 0 ? [] : [...DEVICE_CONTROL_AGENT_TOOLS];
  }
  return withExtensionTools(session, [...requestedToolNames]);
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private promptRunning = false;
  private stopping = false;
  private lastPromptFailed = false;
  private lastPromptErrorSummary: string | undefined;
  private runStartedAt: number | null = null;
  private taskActivity: TaskRuntimeActivity | null = null;
  private fallbackTaskTitle: string | null = null;
  private lastStreamActivityAt = 0;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private activePromptRun: PromptRunIdentity | undefined;
  private goalState: GoalRunState | undefined;
  private _alive = true;

  constructor(
    public readonly inner: AgentSessionLike,
    public readonly runtimeProfile: AgentRuntimeProfile = "normal",
  ) {}

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  get cwd(): string {
    return this.inner.sessionManager.getCwd();
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && this.getRuntime() !== "idle";
  }

  getRuntime(): Runtime {
    if (!this._alive) return "idle";
    if (this.stopping) return "stopping";
    if (this.inner.isCompacting) return "compacting";
    if (this.promptRunning || this.inner.isStreaming || this.inner.isBashRunning) return "running";
    return "idle";
  }

  getTaskRuntimeSnapshot(): TaskRuntimeSnapshot {
    const runtime = this.getRuntime();
    if (runtime === "idle") this.runStartedAt = null;
    else this.runStartedAt ??= Date.now();
    const title = compactTaskActivityText(
      this.inner.sessionManager.getSessionName() || this.fallbackTaskTitle || "",
      80,
    );
    return {
      id: this.sessionId,
      runtime,
      pendingApproval: this.pendingUiResponses.size > 0 || this.activeCustomUis.size > 0,
      lastPromptFailed: this.lastPromptFailed,
      ...(this.lastPromptErrorSummary ? { errorSummary: this.lastPromptErrorSummary } : {}),
      ...(this.runStartedAt !== null ? { startedAt: this.runStartedAt } : {}),
      ...(title ? { title } : {}),
      ...(this.taskActivity ? { activity: this.taskActivity } : {}),
    };
  }

  private setTaskActivity(kind: TaskRuntimeActivityKind, message: unknown, streaming = false): void {
    const now = Date.now();
    if (streaming && now - this.lastStreamActivityAt < TASK_ACTIVITY_STREAM_INTERVAL_MS) return;
    const compact = compactTaskActivityText(message);
    if (!compact) return;
    this.taskActivity = { kind, message: compact, updatedAt: now };
    if (streaming) this.lastStreamActivityAt = now;
  }

  private beginRun(kind: TaskRuntimeActivityKind, message: unknown): void {
    this.runStartedAt = Date.now();
    this.lastStreamActivityAt = 0;
    this.setTaskActivity(kind, message);
  }

  private updateActivityFromEvent(event: AgentEvent): void {
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
      this.setTaskActivity("compacting", "Compacting conversation context");
      return;
    }
    if (event.type === "auto_retry_start") {
      this.setTaskActivity("retry", event.errorMessage ?? "Retrying the model request");
      return;
    }
    if (event.type === "extension_ui_request") {
      this.setTaskActivity("approval", event.title ?? event.message ?? "Waiting for your input");
    }
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      this.updateActivityFromEvent(event);
      if (event.type === "agent_start") {
        this.lastPromptFailed = false;
        this.lastPromptErrorSummary = undefined;
      }
      if (event.type === "agent_end") {
        invalidateSessionListCache();
      }
      this.emit(event);
      // Streaming / compaction / tool events flow through here; re-broadcast
      // the running-status snapshot so the sidebar can update live.
      notifyRunningChange();
    });
    this.resetIdleTimer();
    notifyRunningChange();
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
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
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
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
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in Pi Web.",
          } as ExtensionUiRequest as AgentEvent),
          onError: (error) => this.emit({
            type: "extension_error",
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.applyForcedEmptySystemPrompt();
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
    return type === "prompt" || type === "steer" || type === "follow_up" || type === "get_commands";
  }

  private async withFinalRunningNotification<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      notifyRunningChange();
    }
  }

  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }

  private emit(event: AgentEvent): void {
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

  private persistBashOnlySession(): void {
    const manager = this.inner.sessionManager;
    const sessionFile = manager.getSessionFile();
    if (!sessionFile || existsSync(sessionFile)) return;

    const header = manager.getHeader();
    if (!header) return;

    const content = [header, ...manager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n";
    writeFileSync(sessionFile, content, { encoding: "utf8", flag: "wx" });

    // Pi normally delays the first flush until an assistant message exists.
    // A leading shell command has no assistant message, so mark this SDK
    // manager as flushed after writing its own generated entries.
    (manager as unknown as { flushed: boolean }).flushed = true;
    cacheSessionPath(this.inner.sessionId, sessionFile);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (this.runtimeProfile === "device-control" && DEVICE_CONTROL_DENIED_RPC_COMMANDS.has(type)) {
      throw new Error(`RPC command ${type} is disabled by the device-control runtime profile.`);
    }
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();

    if (type === "prompt" || type === "steer" || type === "follow_up") {
      const imageError = validateAgentImages(command.images);
      if (imageError) throw new Error(imageError);
    }

    switch (type) {
      case "prompt": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot send a prompt while a shell command is running");
        }
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
        const goalMode = command.goalMode === true && !streamingBehavior;
        const promptText = compactTaskActivityText(command.message);
        this.fallbackTaskTitle = compactTaskActivityText(command.message, 80) || this.fallbackTaskTitle;
        this.beginRun("prompt", promptText || "Processing request");
        this.lastPromptFailed = false;
        this.lastPromptErrorSummary = undefined;
        const ownsPromptRun = !streamingBehavior || !this.activePromptRun;
        if (!goalMode && ownsPromptRun) this.goalState = undefined;
        const promptRun = ownsPromptRun
          ? beginPromptRun(this.inner.sessionId)
          : this.activePromptRun!;
        if (ownsPromptRun) this.activePromptRun = promptRun;
        if (goalMode) {
          this.goalState = beginGoalRun(promptRun, String(command.message ?? ""));
          this.emit({ type: "goal_start", goal: this.goalState });
        }
        this.promptRunning = true;
        notifyRunningChange();
        Promise.resolve().then(async () => {
          await this.inner.prompt(command.message as string, {
            ...(promptImages?.length ? { images: promptImages } : {}),
            ...(streamingBehavior ? { streamingBehavior } : {}),
            source: "rpc",
          });
          if (goalMode) {
            while (getGoalRun(this.inner.sessionId)?.status === "active") {
              const current = getGoalRun(this.inner.sessionId)!;
              if (current.iteration >= GOAL_MODE_MAX_CONTINUATIONS) {
                this.goalState = forceBlockGoal(promptRun, `Target mode reached its ${GOAL_MODE_MAX_CONTINUATIONS}-continuation safety limit. Review progress and start a new target-mode run to continue.`);
                break;
              }
              this.goalState = advanceGoalIteration(promptRun);
              this.emit({ type: "goal_progress", goal: this.goalState });
              await this.inner.prompt(GOAL_MODE_CONTINUATION, { source: "rpc" });
            }
            this.goalState = getGoalRun(this.inner.sessionId) ?? this.goalState;
            this.emit({ type: "goal_done", goal: this.goalState });
          }
        })
          .then(async () => {
          this.promptRunning = false;
          if (ownsPromptRun) {
            await finishPromptRun(promptRun, "idle");
            if (this.activePromptRun?.runId === promptRun.runId) this.activePromptRun = undefined;
          }
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
          notifyRunningChange();
        }).catch(async (error) => {
          this.promptRunning = false;
          if (ownsPromptRun) {
            await finishPromptRun(promptRun, "error");
            if (this.activePromptRun?.runId === promptRun.runId) this.activePromptRun = undefined;
          }
          this.lastPromptFailed = true;
          this.lastPromptErrorSummary = error instanceof Error ? error.message : String(error);
          invalidateSessionListCache();
          this.emit({
            type: "prompt_error",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          if (!streamingBehavior) this.emit({ type: "prompt_done" });
          notifyRunningChange();
        });
        return null;
      }

      case "abort": {
        const promptRun = this.activePromptRun;
        this.stopping = true;
        notifyRunningChange();
        try {
          await this.withFinalRunningNotification(() => this.inner.abort());
        } finally {
          await finishPromptRun(promptRun, "abort");
          if (this.activePromptRun?.runId === promptRun?.runId) this.activePromptRun = undefined;
          this.stopping = false;
          notifyRunningChange();
        }
        return null;
      }

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          runtimeProfile: this.runtimeProfile,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isBashRunning: this.inner.isBashRunning,
          isCompacting: this.inner.isCompacting,
          goal: this.goalState,
          runtime: this.getRuntime(),
          pendingApproval: this.pendingUiResponses.size > 0 || this.activeCustomUis.size > 0,
          lastPromptFailed: this.lastPromptFailed,
          lastPromptErrorSummary: this.lastPromptErrorSummary,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        let model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) {
          await this.inner.modelRuntime.refresh({ allowNetwork: false });
          model = this.inner.modelRuntime.getModel(provider, modelId);
        }
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        invalidateModelsCache();
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot fork while a shell command is running");
        }
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        try {
          await bindSessionAgentRuntimeProfile(newSessionId, this.runtimeProfile);
        } catch (profileError) {
          quarantineUnboundSessionFile(newSessionFile);
          throw profileError;
        }
        cacheSessionPath(newSessionId, newSessionFile);
        invalidateSessionListCache();
        await finishPromptRun(this.activePromptRun, "fork");
        this.activePromptRun = undefined;
        this.destroy();
        return { cancelled: false, newSessionId, runtimeProfile: this.runtimeProfile };
      }

      case "navigate_tree": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot navigate while a shell command is running");
        }
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        invalidateSessionListCache();
        return null;
      }

      case "compact": {
        this.beginRun("compacting", "Compacting conversation context");
        try {
          return await this.withFinalRunningNotification(() =>
            this.inner.compact(command.customInstructions as string | undefined)
          );
        } finally {
          invalidateSessionListCache();
        }
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        invalidateSessionListCache();
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        const requested = Array.isArray(command.toolNames)
          ? command.toolNames.filter((name): name is string => typeof name === "string")
          : [];
        const toolNames = resolveAgentToolsForRuntimeProfile(this.runtimeProfile, requested) ?? [];
        this.setForceEmptySystemPrompt(toolNames.length === 0);
        this.inner.setActiveToolsByName(activeToolsForProfile(this.inner, this.runtimeProfile, toolNames));
        this.applyForcedEmptySystemPrompt();
        return null;
      }

      case "reload": {
        await this.waitForExtensionsBound();
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload();
        if (typeof this.inner.bindExtensions !== "function") {
          this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
        }
        this.applyForcedEmptySystemPrompt();
        invalidateModelsCache();
        return { success: true };
      }

      case "abort_compaction": {
        this.stopping = true;
        notifyRunningChange();
        try {
          this.inner.abortCompaction();
        } finally {
          this.stopping = false;
          notifyRunningChange();
        }
        return null;
      }

      case "extension_ui_response": {
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      case "bash": {
        if (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning) {
          throw new Error("Cannot run a shell command while the session is busy");
        }
        this.beginRun("command", command.command);
        const execution = this.inner.executeBash(
          command.command as string,
          undefined,
          { excludeFromContext: command.excludeFromContext as boolean | undefined },
        );
        notifyRunningChange();
        try {
          const result = await execution;
          this.persistBashOnlySession();
          return result;
        } finally {
          invalidateSessionListCache();
          notifyRunningChange();
        }
      }

      case "abort_bash": {
        this.stopping = true;
        notifyRunningChange();
        try {
          this.inner.abortBash();
        } finally {
          this.stopping = false;
          notifyRunningChange();
        }
        return null;
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.inner.isBashRunning) this.inner.abortBash();
    const promptRun = this.activePromptRun;
    this.activePromptRun = undefined;
    void finishPromptRun(promptRun, "destroy");
    this.unsubscribe?.();
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.onDestroyCallback?.();
    notifyRunningChange();
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    } as ExtensionUiRequest as AgentEvent;
    this.pendingUiRequests.set(id, event);
    this.emit(event);
    notifyRunningChange();
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    notifyRunningChange();
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as AgentEvent);
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(
    factory: unknown,
    options?: unknown,
  ): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      let completed = false;
      const tui = createHeadlessCustomUiTui(
        () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
        width,
      );
      const finish = (value: T) => {
        if (completed) return;
        completed = true;
        resolve(value);
      };
      const done = (value: T) => {
        if (this.activeCustomUis.has(id)) {
          this.closeCustomUi(id, value);
        } else {
          finish(value);
        }
      };

      Promise.resolve()
        .then(() => factory(tui, PLAIN_TEXT_THEME, CUSTOM_UI_KEYBINDINGS, done))
        .then((component) => {
          if (completed) {
            try {
              (component as CustomUiComponent | undefined)?.dispose?.();
            } catch {
              // Ignore dispose errors from a component completed before mounting.
            }
            return;
          }
          if (!component || typeof component !== "object" || typeof (component as CustomUiComponent).render !== "function") {
            finish(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => finish(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          if (completed) return;
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          finish(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
        notifyRunningChange();
      };
      const settle = (value: T) => {
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
      notifyRunningChange();
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike {
    return {
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.extensionWidgets.delete(key);
        } else {
          this.extensionWidgets.set(key, {
            key,
            lines: content,
            placement: options?.placement ?? "aboveEditor",
          });
        }
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        } as ExtensionUiRequest as AgentEvent);
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() { return PLAIN_TEXT_THEME; },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in Pi Web extension UI yet" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.extensionStatuses.clear();
        this.extensionWidgets.clear();
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
        this.applyForcedEmptySystemPrompt();
      },
    };
  }

}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  var __piStartingSessionCwds: Map<string, number> | undefined;
  var __piRunningListeners: Set<(sessions: TaskRuntimeSnapshot[]) => void> | undefined;
  var __piServicesCache: Map<string, AgentSessionServices> | undefined;
}

// ============================================================================
// Per-cwd session services cache
//
// `createAgentSessionServices()` is expensive (~5-8s: ModelRuntime.create +
// resource loader reload + model runtime refresh). Every session start used to
// pay that cost again, and its synchronous work blocks the Node event loop, so
// switching sessions (which creates the AgentSession for the target session)
// stalled unrelated requests — including the session-messages GET the UI needs
// to render the composer — leaving the chat stuck in "loading" with no input
// for many seconds.
//
// Sessions of the same cwd share the SDK services object safely: each
// AgentSession builds its own extension runner from the shared resource
// loader. Invalidate via invalidateServicesCache() whenever models, auth,
// settings, skills, or plugins change.
// ============================================================================

function getServicesCache(): Map<string, AgentSessionServices> {
  if (!globalThis.__piServicesCache) globalThis.__piServicesCache = new Map();
  return globalThis.__piServicesCache;
}

/** Drop cached per-cwd services so the next session start reloads them. */
export function invalidateServicesCache(): void {
  getServicesCache().clear();
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

function getStartingSessionCwds(): Map<string, number> {
  if (!globalThis.__piStartingSessionCwds) globalThis.__piStartingSessionCwds = new Map();
  return globalThis.__piStartingSessionCwds;
}

function trackStartingSession(cwd: string): () => void {
  const startingCwds = getStartingSessionCwds();
  const key = normalizeRpcCwd(cwd);
  startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
  return () => {
    const remaining = (startingCwds.get(key) ?? 1) - 1;
    if (remaining > 0) startingCwds.set(key, remaining);
    else startingCwds.delete(key);
  };
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export function hasBusyRpcSessionForCwd(cwd: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  if (getStartingSessionCwds().has(targetCwd)) return true;
  return Array.from(getRegistry().values()).some(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export function destroyRpcSessionsForCwd(cwd: string): number {
  const targetCwd = normalizeRpcCwd(cwd);
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd,
  );
  for (const session of sessions) session.destroy();
  return sessions.length;
}

export function getRunningRpcSessionIds(): string[] {
  return getRunningRpcSessionStatuses()
    .filter((session) => session.runtime !== "idle")
    .map((session) => session.id);
}

export function getRunningRpcSessionStatuses(): TaskRuntimeSnapshot[] {
  const statuses: TaskRuntimeSnapshot[] = [];
  for (const session of getRegistry().values()) {
    if (!session.isAlive()) continue;
    // globalThis deliberately retains wrappers across Next.js hot reloads.
    // A wrapper created by the previous module version does not yet have the
    // three-axis accessor, so adapt it until that live session is recreated.
    const snapshot = typeof session.getTaskRuntimeSnapshot === "function"
      ? session.getTaskRuntimeSnapshot()
      : {
          id: session.sessionId,
          runtime: session.inner.isCompacting ? "compacting" as const : session.isRunning() ? "running" as const : "idle" as const,
          pendingApproval: false,
          lastPromptFailed: false,
        };
    if (snapshot.runtime !== "idle" || snapshot.pendingApproval || snapshot.lastPromptFailed) {
      statuses.push(snapshot);
    }
  }
  return statuses.sort((a, b) => a.id.localeCompare(b.id));
}

export interface UnpersistedSessionInfo {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionPath?: string;
}

/**
 * Session infos for live registry sessions missing from the caller's disk
 * scan. The primary case: pi delays the first file write until an assistant
 * message exists, so a brand-new session is invisible to the session list
 * (and thus the sidebar) until its first turn completes. Entries already
 * covered by the disk scan are excluded via `excludeIds` — not via
 * existsSync — because a freshly flushed file may still be absent from a
 * cached (TTL) scan, and the registry entry must bridge that window too.
 * Field semantics mirror the SDK's buildSessionInfo() so merged entries
 * render identically to disk entries.
 */
export function getUnpersistedSessionInfos(excludeIds?: ReadonlySet<string>): UnpersistedSessionInfo[] {
  const infos: UnpersistedSessionInfo[] = [];
  for (const session of getRegistry().values()) {
    if (!session.isAlive()) continue;
    if (excludeIds?.has(session.sessionId)) continue;
    const sessionFile = session.sessionFile;
    if (!sessionFile) continue;

    const manager = session.inner.sessionManager;
    const header = manager.getHeader();
    if (!header) continue;

    let messageCount = 0;
    let firstMessage = "";
    let lastActivityMs = Date.parse(header.timestamp);
    for (const entry of manager.getEntries()) {
      if (entry.type !== "message") continue;
      messageCount += 1;
      const message = entry.message;
      if (message.role !== "user" && message.role !== "assistant") continue;
      const timestamp = (message as { timestamp?: unknown }).timestamp;
      const activityMs = typeof timestamp === "number" ? timestamp : Date.parse(entry.timestamp);
      if (!Number.isNaN(activityMs)) lastActivityMs = Math.max(lastActivityMs, activityMs);
      if (!firstMessage && message.role === "user") {
        firstMessage = typeof message.content === "string"
          ? message.content
          : message.content
              .filter((block): block is { type: "text"; text: string } => (block as { type?: unknown }).type === "text")
              .map((block) => block.text)
              .join(" ");
      }
    }

    infos.push({
      id: session.sessionId,
      path: sessionFile,
      cwd: header.cwd || session.cwd,
      name: manager.getSessionName(),
      created: header.timestamp,
      modified: new Date(Number.isNaN(lastActivityMs) ? Date.now() : lastActivityMs).toISOString(),
      messageCount,
      firstMessage: firstMessage || "(no messages)",
      ...(header.parentSession ? { parentSessionPath: header.parentSession } : {}),
    });
  }
  return infos;
}

// ----------------------------------------------------------------------------
// Running-status broadcaster
//
// Pushes the current set of running session ids to subscribers whenever any
// session's running state may have changed. This lets the sidebar receive live
// updates over SSE instead of polling. Listeners live on globalThis so they
// survive Next.js hot-reload.
// ----------------------------------------------------------------------------

function getRunningListeners(): Set<(sessions: TaskRuntimeSnapshot[]) => void> {
  if (!globalThis.__piRunningListeners) globalThis.__piRunningListeners = new Set();
  return globalThis.__piRunningListeners;
}

/** Subscribe to running-session-id changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(listener: (sessions: TaskRuntimeSnapshot[]) => void): () => void {
  const listeners = getRunningListeners();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let lastRunningSnapshot = "";

/**
 * Recompute the running-session-id set and, if it changed since the last
 * notification, broadcast it to subscribers. Cheap to call often.
 */
export function notifyRunningChange(): void {
  const sessions = getRunningRpcSessionStatuses();
  const snapshot = JSON.stringify(sessions);
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of getRunningListeners()) {
    try { listener(sessions); } catch { /* ignore listener errors */ }
  }
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * New sessions resolve enabledModels before construction so the initial model,
 * thinking pin, and SDK scopedModels share one settings snapshot.
 * Pass options.toolNames to pre-configure active tools (empty = all disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  options: RpcSessionStartOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const { initialModel, thinkingLevel } = options;
  const processRuntimeProfile = getAgentRuntimeProfile();
  const runtimeProfile = options.runtimeProfile ?? processRuntimeProfile;
  assertCurrentAgentRuntimeProfile(runtimeProfile);
  if (sessionFile) {
    await resolveSessionAgentRuntimeProfile(sessionId, runtimeProfile);
  } else {
    // Validate the authoritative store before the SDK creates a new session
    // file. Device-control never falls back to an unbound session.
    readAgentProfileStore();
  }
  const toolNames = resolveAgentToolsForRuntimeProfile(runtimeProfile, options.toolNames);
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) {
    if (existing.runtimeProfile !== runtimeProfile) {
      throw new Error(`Live session ${sessionId} has a mismatched or unknown runtime profile.`);
    }
    return { session: existing, realSessionId: sessionId };
  }

  const lockKey = `${runtimeProfile}:${sessionId}`;
  const inflight = locks.get(lockKey);
  if (inflight) return inflight;

  const finishStartingSession = trackStartingSession(cwd);
  const starting = (async () => {
    // Some extensions access the SDK's global theme even outside the terminal UI.
    initTheme();
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined;
    if (runtimeProfile === "device-control") {
      // Passing the exact allow-list prevents built-in coding tools from even
      // entering the AgentSession registry. This is stronger than merely
      // marking them inactive after extensions have loaded.
      toolsOption = toolNames ?? [...DEVICE_CONTROL_AGENT_TOOLS];
    } else if (toolNames !== undefined) {
      // toolNames === [] -> "all off" (an empty allow-list disables every tool).
      // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
      // set allowedToolNames to coding builtins only, which filtered every
      // extension/package-provided tool (e.g. subagents, web access) out of the
      // tool registry — so they were unavailable in Pi Web sessions even though the
      // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
      // tools (and activate extension tools); we narrow the ACTIVE set below.
      toolsOption = toolNames.length === 0 ? [] : undefined;
    }

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    // Services are cached per cwd: reusing the model runtime + resource loader
    // turns a ~5-8s session start into milliseconds and stops session creation
    // from blocking the event loop (which stalled session loading and left the
    // composer hidden while switching sessions).
    const cwdKey = `${runtimeProfile}:${normalizeRpcCwd(cwd)}`;
    let services = getServicesCache().get(cwdKey);
    if (!services) {
      const bundledBrowserExtension = resolve(process.cwd(), "extensions", "piora-browser.ts");
      const bundledHarmonyExtension = resolve(process.cwd(), "extensions", "piora-harmony.ts");
      const bundledGoalExtension = resolve(process.cwd(), "extensions", "piora-goal.ts");
      if (runtimeProfile === "device-control" && (!existsSync(bundledHarmonyExtension) || !existsSync(bundledGoalExtension))) {
        throw new Error("A required first-party device-control extension is missing.");
      }
      services = await createAgentSessionServices({
        cwd,
        agentDir,
        ...(runtimeProfile === "device-control"
          ? {
              resourceLoaderOptions: {
                additionalExtensionPaths: [bundledHarmonyExtension, bundledGoalExtension],
                noExtensions: true,
                noSkills: true,
                noPromptTemplates: true,
                noThemes: true,
                noContextFiles: true,
                systemPromptOverride: () => undefined,
                appendSystemPromptOverride: () => [],
                agentsFilesOverride: () => ({ agentsFiles: [] }),
              },
            }
          : existsSync(bundledGoalExtension)
            ? { resourceLoaderOptions: { additionalExtensionPaths: [bundledBrowserExtension, bundledGoalExtension].filter(existsSync) } }
            : {}),
      });
      if (runtimeProfile === "device-control") {
        const extensionResult = services.resourceLoader.getExtensions();
        const loadedPaths = extensionResult.extensions.map((extension) => realpathSync(extension.resolvedPath));
        const expectedPaths = [bundledHarmonyExtension, bundledGoalExtension].map((path) => realpathSync(path)).sort();
        if (extensionResult.errors.length > 0 || loadedPaths.length !== expectedPaths.length || loadedPaths.sort().some((path, index) => path !== expectedPaths[index])) {
          throw new Error("The device-control resource loader did not resolve exactly the first-party Harmony and target-mode extensions.");
        }
        if (
          services.resourceLoader.getSkills().skills.length > 0
          || services.resourceLoader.getPrompts().prompts.length > 0
          || services.resourceLoader.getAgentsFiles().agentsFiles.length > 0
          || services.resourceLoader.getSystemPrompt() !== undefined
          || services.resourceLoader.getAppendSystemPrompt().length > 0
        ) {
          throw new Error("The device-control resource loader admitted user skills, prompts, system prompts, or context files.");
        }
      }
      getServicesCache().set(cwdKey, services);
    }
    if (runtimeProfile === "normal") ensureWindowsBashShellPath(services.settingsManager);
    const scope = await resolveVisibleModels(
      services.modelRuntime,
      services.settingsManager.getEnabledModels(),
    );
    const defaultProvider = services.settingsManager.getDefaultProvider();
    const defaultModelId = services.settingsManager.getDefaultModel();
    const preferredDefault = resolveDefaultModelPreference({
      models: scope.visible,
      settingsProvider: defaultProvider,
      settingsModel: defaultModelId,
      environment: process.env,
    });
    const initial = sessionFile
      ? { scopedModels: [...scope.scopedModels] }
      : selectInitialModelScope(scope, {
        ...(initialModel ? { requestedModel: initialModel } : {}),
        ...(preferredDefault ? { defaultModel: preferredDefault } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      });
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(initial.model ? { model: initial.model } : {}),
      ...(initial.thinkingLevel ? { thinkingLevel: initial.thinkingLevel } : {}),
      ...(initial.scopedModels.length > 0 ? { scopedModels: initial.scopedModels } : {}),
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });

    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in Pi Web just like in the `pi` CLI.
    if (toolNames && toolNames.length > 0) {
      inner.setActiveToolsByName(activeToolsForProfile(inner, runtimeProfile, toolNames));
    }

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    try {
      await bindSessionAgentRuntimeProfile(realSessionId, runtimeProfile);
    } catch (error) {
      if (!sessionFile && realSessionFile) quarantineUnboundSessionFile(realSessionFile);
      throw error;
    }

    const wrapper = new AgentSessionWrapper(inner, runtimeProfile);
    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // keep this forced after extension resource discovery and reloads as well.
    if (toolNames?.length === 0) {
      wrapper.setForceEmptySystemPrompt(true);
    }
    wrapper.start();

    if (realSessionFile) cacheSessionPath(realSessionId, realSessionFile);

    wrapper.onDestroy(() => { registry.delete(realSessionId); });
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: toolNames?.length === 0 });

    return { session: wrapper, realSessionId };
  })().finally(() => {
    locks.delete(lockKey);
    finishStartingSession();
  });

  locks.set(lockKey, starting);
  return starting;
}
