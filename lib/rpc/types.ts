import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentRuntimeProfile } from "../agent-runtime-profile";
import type { RemoteSessionPolicy } from "../remote-session-policy";
import type { SessionCapabilitySelection } from "../session-capabilities";
import type { SystemPromptSelection } from "../system-prompt-types";
import type { ExtensionUiRequest, ExtensionUiResponse } from "../types";
import type { AgentSessionWrapper } from "./session-wrapper";

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export type EventListener = (event: AgentEvent) => void;

export type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

export type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

export type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

export type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

export type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

export type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

export interface RpcSessionStartOptions {
  /** Host-only child runtime controls. Never populated from model/API input. */
  subagentParent?: AgentSessionWrapper;
  subagentSystemPrompt?: string;
  subagentDirectory?: string;
  preparedSessionFile?: string;
  remotePolicy?: RemoteSessionPolicy;
  /** Pinned Team profiles prohibit startup model fallback. */
  allowModelFallback?: boolean;
  toolNames?: string[];
  capabilitySelection?: SessionCapabilitySelection;
  initialModel?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
  systemPromptSelection?: SystemPromptSelection;
  runtimeProfile?: AgentRuntimeProfile;
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

export const DEVICE_CONTROL_DENIED_RPC_COMMANDS = new Set(["bash", "abort_bash"]);
