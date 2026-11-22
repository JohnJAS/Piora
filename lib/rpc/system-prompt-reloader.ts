import type { AgentRuntimeProfile } from "../agent-runtime-profile";
import { invalidateModelsCache } from "../models-cache";
import type { AgentSessionLike, ExtensionUiContextLike } from "../pi-types";
import { invalidateSessionListCache } from "../session-reader";
import {
  appendSessionSystemPromptBinding,
  createSessionSystemPromptBinding,
  readLatestSessionSystemPromptBinding,
} from "../session-system-prompt";
import { readSystemPromptConfig } from "../system-prompt-config";
import type { SessionSystemPromptBinding, SystemPromptSelection } from "../system-prompt-types";
import type { AgentEvent } from "./types";

export interface SystemPromptReloaderHost {
  readonly sessionId: string;
  readonly runtimeProfile: AgentRuntimeProfile;
  getInner: () => AgentSessionLike;
  isAlive: () => boolean;
  isRunning: () => boolean;
  assertSessionIdle: (action: string) => void;
  waitForExtensionsBound: () => Promise<void>;
  clearUiStatusesAndWidgets: () => void;
  createExtensionUiContext: () => ExtensionUiContextLike;
  reapplySessionCapabilities: () => void;
  emit: (event: AgentEvent) => void;
}

export class SystemPromptReloader {
  forceEmptySystemPrompt = false;
  private emptySystemPromptProjectionInstalled = false;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private reloadRequested = 0;
  private reloadApplied = 0;
  private reloading = false;

  constructor(private readonly host: SystemPromptReloaderHost) {}

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
  }

  applyForcedEmptySystemPrompt(): void {
    if (this.emptySystemPromptProjectionInstalled) return;
    this.emptySystemPromptProjectionInstalled = true;
    const inner = this.host.getInner();
    const previous = inner.agent.transformContext?.bind(inner.agent);
    inner.agent.transformContext = async (messages, signal) => {
      const projected = previous ? await previous(messages, signal) : messages;
      if (!this.forceEmptySystemPrompt) return projected;
      // Pi 1.0 replays prompt state from system messages; the state getter is
      // readonly and SessionManager remains authoritative for raw history.
      return [
        { role: "system", content: "", toolsAdded: [], timestamp: Date.now() },
        ...projected.filter(message => message.role !== "system"),
      ];
    };
  }

  getBinding(): SessionSystemPromptBinding | null {
    return readLatestSessionSystemPromptBinding(this.host.getInner().sessionManager.getEntries());
  }

  async setBinding(selection: SystemPromptSelection): Promise<SessionSystemPromptBinding> {
    this.host.assertSessionIdle("change the system prompt");
    if (this.host.runtimeProfile !== "normal") throw new Error("System prompt templates are available only for normal sessions.");
    const previous = this.getBinding();
    const binding = createSessionSystemPromptBinding(selection, readSystemPromptConfig(), previous);
    appendSessionSystemPromptBinding(this.host.getInner().sessionManager, binding);
    invalidateSessionListCache();
    await this.requestReload();
    return binding;
  }

  async requestReload(): Promise<"reloaded" | "deferred" | "skipped"> {
    if (!this.host.isAlive() || this.host.runtimeProfile !== "normal") return "skipped";
    this.reloadRequested += 1;
    if (this.host.isRunning() || this.reloading) {
      this.scheduleReload();
      return "deferred";
    }
    await this.flushReload();
    return "reloaded";
  }

  dispose(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  private scheduleReload(): void {
    if (!this.host.isAlive() || this.reloadTimer) return;
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.flushReload().catch((error) => {
        console.error("[pi-web] deferred system prompt reload failed:", error instanceof Error ? error.message : error);
        this.scheduleReload();
      });
    }, 250);
  }

  private async flushReload(): Promise<void> {
    if (!this.host.isAlive() || this.reloadApplied >= this.reloadRequested) return;
    if (this.host.isRunning() || this.reloading) {
      this.scheduleReload();
      return;
    }
    this.reloading = true;
    const revision = this.reloadRequested;
    try {
      await this.host.waitForExtensionsBound();
      this.host.clearUiStatusesAndWidgets();
      const inner = this.host.getInner();
      await inner.reload();
      if (typeof inner.bindExtensions !== "function") {
        inner.extensionRunner.setUIContext?.(this.host.createExtensionUiContext(), "rpc");
      }
      this.host.reapplySessionCapabilities();
      this.reloadApplied = revision;
      invalidateModelsCache();
      this.host.emit({
        type: "system_prompt_reloaded",
        sessionId: this.host.sessionId,
        systemPrompt: inner.agent.state?.systemPrompt ?? "",
      });
    } finally {
      this.reloading = false;
      if (this.reloadApplied < this.reloadRequested) this.scheduleReload();
    }
  }
}
