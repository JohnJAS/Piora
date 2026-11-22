import { randomUUID } from "node:crypto";
import type { ChatCommandPhase } from "../chat-command-types";
import { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS } from "../custom-ui-terminal";
import type { AgentSessionLike, ExtensionUiContextLike } from "../pi-types";
import { notifyRunningChange } from "../rpc-running-status";
import { CUSTOM_UI_KEYBINDINGS, PLAIN_TEXT_THEME } from "../rpc-ui-adapter";
import type { ExtensionUiRequest, ExtensionUiResponse, ExtensionWidgetItem } from "../types";
import { userInputTimeoutMs, type UserInputResult } from "../user-input";
import type {
  ActiveCustomUi,
  AgentEvent,
  CustomUiComponent,
  EventListener,
  ExtensionCommandContextActionsLike,
  ExtensionUiRequestBody,
  PendingUiResponse,
} from "./types";

export interface ExtensionUiBridgeHost {
  isAlive: () => boolean;
  isStopping: () => boolean;
  getAbortGeneration: () => number;
  getInner: () => AgentSessionLike;
  getPermissionParentUi: () => Pick<ExtensionUiBridge, "requestExtensionUi"> | undefined;
  getSubagentUiSignal: () => AbortSignal;
  getChatCommandActivity: () => {
    readonly commandId: string | undefined;
    phase: (phase: ChatCommandPhase) => void;
    fail: (error: Error) => void;
  };
  emit: (event: AgentEvent) => void;
  applyForcedEmptySystemPrompt: () => void;
}

export class ExtensionUiBridge {
  readonly pendingUiResponses = new Map<string, PendingUiResponse>();
  readonly pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private userInputPresented = true;
  private userInputTimers = new Map<string, { pause: () => void; resume: () => void; snooze: () => void }>();

  constructor(private readonly host: ExtensionUiBridgeHost) {}

  setUserInputPresented(presented: boolean): void {
    const next = Boolean(presented);
    if (this.userInputPresented === next) return;
    this.userInputPresented = next;
    for (const timer of this.userInputTimers.values()) {
      if (next) timer.resume();
      else timer.pause();
    }
  }

  recordUserInputActivity(id?: string): void {
    if (typeof id === "string" && id.trim()) {
      this.userInputTimers.get(id.trim())?.snooze();
      return;
    }
    for (const timer of this.userInputTimers.values()) timer.snooze();
  }

  hasPendingApproval(): boolean {
    return this.pendingUiResponses.size > 0 || this.activeCustomUis.size > 0;
  }

  getPendingUiRequests(): ExtensionUiRequest[] {
    return this.host.isAlive() ? [...this.pendingUiRequests.values()] as ExtensionUiRequest[] : [];
  }

  replayPendingRequests(listener: EventListener): void {
    for (const event of this.pendingUiRequests.values()) listener(event);
  }

  getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  clearStatusesAndWidgets(): void {
    this.extensionStatuses.clear();
    this.extensionWidgets.clear();
  }

  resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    pending.resolve(response);
  }

  releaseToolApprovals(): void {
    for (const [id, event] of this.pendingUiRequests) {
      if (event.method === "confirm" && event.toolApproval === true) {
        this.pendingUiResponses.get(id)?.resolve({ type: "extension_ui_response", id, confirmed: true });
      }
    }
  }

  cancelAllForDestroy(): void {
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
  }

  createAbortCancelTasks(signal: (cancel: () => unknown) => Promise<unknown>): Promise<unknown>[] {
    return [
      ...Array.from(this.pendingUiResponses.values(), (pending) => signal(() => pending.cancel())),
      ...Array.from(this.activeCustomUis.keys(), (id) => signal(() => this.closeCustomUi(id, undefined))),
    ];
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
    this.host.emit(event);
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
    this.host.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as AgentEvent);
    custom.resolve(value);
  }

  handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.host.emit({
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
    if (typeof factory !== "function" || this.host.isStopping() || !this.host.isAlive()) return Promise.resolve(undefined as T);
    const abortGeneration = this.host.getAbortGeneration();

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
          if (abortGeneration !== this.host.getAbortGeneration() || !this.host.isAlive()) finish(undefined as T);
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
          this.host.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          finish(undefined as T);
        });
    });
  }

  requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
    timeoutValue: T = defaultValue,
  ): Promise<T> {
    const permissionParent = this.host.getPermissionParentUi();
    if (permissionParent) {
      const subagentSignal = this.host.getSubagentUiSignal();
      return permissionParent.requestExtensionUi(
        request,
        defaultValue,
        parseResponse,
        timeout,
        signal ? AbortSignal.any([signal, subagentSignal]) : subagentSignal,
        timeoutValue,
      );
    }
    if (signal?.aborted || this.host.isStopping() || !this.host.isAlive()) return Promise.resolve(defaultValue);

    const id = randomUUID();
    const activity = this.host.getChatCommandActivity();
    const isUserInput = request.method === "request_user_input";
    let snoozed = false;
    let paused = isUserInput && !this.userInputPresented;
    let remainingMs = timeout ?? 0;
    let startedAt: number | undefined;
    const fullRequest: Record<string, unknown> & {
      type: "extension_ui_request";
      id: string;
      commandId?: string;
      method: ExtensionUiRequest["method"];
      timeout?: number;
      expiresAt?: number;
      snoozed?: boolean;
      paused?: boolean;
    } = {
      type: "extension_ui_request",
      id,
      commandId: activity.commandId,
      ...request,
      ...(timeout ? { timeout } : {}),
      ...(timeout && !paused ? { expiresAt: Date.now() + timeout } : {}),
      ...(isUserInput ? { snoozed, paused } : {}),
    };
    activity.phase("waiting_input");

    return new Promise((resolve) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.userInputTimers.delete(id);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
        notifyRunningChange();
      };
      const settle = (value: T, reason: "answered" | "cancelled" | "timeout") => {
        if (settled) return;
        settled = true;
        cleanup();
        this.host.emit({ type: "extension_ui_request", id, method: "close", reason });
        resolve(value);
      };
      const onAbort = () => settle(defaultValue, "cancelled");
      const syncUserInputState = () => {
        if (!isUserInput || settled) return;
        fullRequest.snoozed = snoozed;
        fullRequest.paused = paused;
        this.pendingUiRequests.set(id, fullRequest as AgentEvent);
        this.host.emit({
          type: "extension_ui_request",
          id,
          method: "request_user_input_state",
          snoozed,
          paused,
          ...(fullRequest.expiresAt ? { expiresAt: fullRequest.expiresAt } : {}),
        } as ExtensionUiRequest as AgentEvent);
      };

      if (timeout && !paused) {
        startedAt = Date.now();
        fullRequest.expiresAt = startedAt + remainingMs;
        timeoutId = setTimeout(() => settle(timeoutValue, "timeout"), remainingMs);
      }
      if (isUserInput) {
        this.userInputTimers.set(id, {
          pause: () => {
            if (settled || snoozed || paused || !timeout) return;
            paused = true;
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
            if (startedAt !== undefined) {
              remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
              startedAt = undefined;
            }
            delete fullRequest.expiresAt;
            syncUserInputState();
          },
          resume: () => {
            if (settled || snoozed || !paused || !timeout) return;
            paused = false;
            if (remainingMs <= 0) { settle(timeoutValue, "timeout"); return; }
            startedAt = Date.now();
            fullRequest.expiresAt = startedAt + remainingMs;
            timeoutId = setTimeout(() => settle(timeoutValue, "timeout"), remainingMs);
            syncUserInputState();
          },
          snooze: () => {
            if (settled || snoozed) return;
            snoozed = true;
            paused = false;
            if (timeoutId) { clearTimeout(timeoutId); timeoutId = undefined; }
            startedAt = undefined;
            delete fullRequest.expiresAt;
            syncUserInputState();
          },
        });
      }
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => {
          // Check wall time as well: a delayed timer must not admit a late answer.
          if (fullRequest.expiresAt && Date.now() >= fullRequest.expiresAt) settle(timeoutValue, "timeout");
          else settle(parseResponse(response), "cancelled" in response ? "cancelled" : "answered");
        },
        cancel: onAbort,
      });
      this.host.emit(fullRequest as AgentEvent);
      notifyRunningChange();
    });
  }

  createExtensionUiContext(): ExtensionUiContextLike {
    const activity = this.host.getChatCommandActivity();
    return {
      requestUserInput: (title, description, questions, opts) => this.requestExtensionUi(
        {
          method: "request_user_input",
          title,
          ...(description ? { description } : {}),
          questions,
          ...(opts?.timeout ? { timeout: opts.timeout } : {}),
        },
        { cancelled: true } as UserInputResult,
        (response) => "answers" in response ? { answers: response.answers } : { cancelled: true },
        userInputTimeoutMs(opts?.timeout),
        opts?.signal,
        { cancelled: true, reason: "timeout" } as UserInputResult,
      ),
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
        if (type === "error") activity.fail(new Error(message));
        this.host.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          commandId: activity.commandId,
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.host.emit({
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
        this.host.emit({
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
        this.host.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.host.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.host.emit({
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

  createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.host.getInner().agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.host.getInner().navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.clearStatusesAndWidgets();
        await this.host.getInner().reload({
          beforeSessionStart: () => {
            this.host.getInner().extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
        this.host.applyForcedEmptySystemPrompt();
      },
    };
  }
}
