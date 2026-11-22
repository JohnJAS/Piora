import type { ModelCatalogRecommendation } from "@/lib/model-catalog";
import type { DiscoveredModel } from "@/lib/model-discovery";
import type { ModelLimitsMeta } from "@/lib/model-limits";
import type { ModelSamplingConfig } from "@/lib/model-sampling";

export interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  /** Provider also accepts an API key, so it appears in both picker sections. */
  supportsApiKey?: boolean;
}

export interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** Provider also supports OAuth, so it appears in both picker sections. */
  supportsOAuth?: boolean;
  canRemoveStoredCredential?: boolean;
}

export type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

export interface ModelEntry extends ModelSamplingConfig {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  /** Session-only captions. Stripped before models.json is written. */
  limitsMeta?: ModelLimitsMeta;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  compat?: Record<string, unknown>;
}

export interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
}

export interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

export interface ConfiguredModelRef {
  provider: string;
  id: string;
}

export function collectConfiguredModelRefs(config: ModelsJson): ConfiguredModelRef[] {
  const refs: ConfiguredModelRef[] = [];
  for (const [provider, entry] of Object.entries(config.providers ?? {})) {
    for (const model of entry.models ?? []) {
      const id = model.id.trim();
      if (id) refs.push({ provider, id });
    }
  }
  return refs;
}

export function configuredModelKey(model: ConfiguredModelRef): string {
  return `${model.provider}/${model.id}`;
}

export interface ManagedModel {
  provider: string;
  id: string;
  name: string;
  enabled: boolean;
}

export interface ModelScopeResponse {
  removedProviders?: string[];
  models: ManagedModel[];
  enabledPatterns: string[] | null;
  projectOverride: boolean;
  warnings: string[];
  enabledCount: number;
  totalCount: number;
  configuredDefault: { provider: string; modelId: string } | null;
  effectiveDefault: { provider: string; modelId: string } | null;
  changed?: boolean;
}

export interface VisionAgentConfigState {
  enabled: boolean;
  provider: string | null;
  modelId: string | null;
}

export interface VisionAgentModelOption {
  provider: string;
  modelId: string;
  name: string;
}

export interface VisionAgentResponse {
  config: VisionAgentConfigState;
  models: VisionAgentModelOption[];
  error?: string;
}

export type VisionAgentTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs: number; observation: string }
  | { phase: "error"; message: string };

export type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

export type ModelDiscoveryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; models: DiscoveredModel[]; endpoint: string }
  | { phase: "error"; message: string };

export type ModelCatalogState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; recommendation: ModelCatalogRecommendation; appliedCount: number }
  | { phase: "error"; message: string };

export type Selection =
  | { type: "vision-agent" }
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string }
  | { type: "managed"; providerId: string };

export const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;
