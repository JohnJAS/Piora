import { withCompactionRetentionLimit } from "../../compaction-settings";
import { estimateContextUsageBreakdown } from "../../context-usage";
import { applyConfiguredImageInput } from "../../model-capabilities";
import { invalidateModelsCache } from "../../models-cache";
import { readRemovedProviders } from "../../removed-providers";
import type { SessionRpcCommand } from "../../session-command-policy";
import { clearPendingSessionModel } from "../../session-model-selection";
import { invalidateSessionListCache } from "../../session-reader";
import type { RpcCommandHost } from "./host";

export async function handleSetModelCommand(host: RpcCommandHost, command: SessionRpcCommand) {
  host.assertSessionIdle("change model");
  const { provider, modelId } = command as { provider: string; modelId: string };
  if (readRemovedProviders().includes(provider)) throw new Error("该渠道已移除，请先在模型设置中恢复渠道。");
  // Live sessions retain a private runtime after settings caches are
  // invalidated. Existing IDs must be refreshed too, not just new models.
  await host.inner.modelRuntime.refresh({ allowNetwork: false });
  host.assertSessionIdle("change model");
  if (!host.isAlive()) throw new Error("Session has been closed");
  const configError = host.inner.modelRuntime.getError?.();
  if (configError) throw new Error(configError);
  const model = host.inner.modelRuntime.getModel(provider, modelId);
  if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
  // Missing or non-positive windows skip this compact. Do not invent a
  // size; legacy resolution is documented in lib/model-limits.ts.
  const targetWindow = model.contextWindow;
  let compacted = false;
  if (Number.isFinite(targetWindow) && targetWindow > 0
    && (host.inner.model?.provider !== provider || host.inner.model?.id !== modelId
      || host.inner.model?.contextWindow !== targetWindow)) {
    const state = host.inner.agent.state;
    const estimate = estimateContextUsageBreakdown({
      messages: state?.messages ?? [],
      systemPrompt: host.forceEmptySystemPrompt ? "" : state?.systemPrompt ?? "",
      tools: state?.tools ?? [],
      totalTokens: null,
    });
    const estimatedTokens = Object.values(estimate).reduce((sum, value) => sum + value, 0);
    const usedTokens = Math.max(host.inner.getContextUsage()?.tokens ?? 0, estimatedTokens);
    if (usedTokens > targetWindow) {
      host.beginRun("compacting", "Compacting conversation before model change");
      try {
        const result = await host.withFinalRunningNotification(() => withCompactionRetentionLimit(
          host.inner.settingsManager,
          Math.floor(targetWindow * 0.4),
          () => host.inner.compact(),
        )) as { estimatedTokensAfter?: number };
        compacted = true;
        const newState = host.inner.agent.state;
        const after = estimateContextUsageBreakdown({
          messages: newState?.messages ?? [],
          systemPrompt: host.forceEmptySystemPrompt ? "" : newState?.systemPrompt ?? "",
          tools: newState?.tools ?? [],
          totalTokens: null,
        });
        const afterTokens = Math.max(result.estimatedTokensAfter ?? 0, Object.values(after).reduce((sum, value) => sum + value, 0));
        if (afterTokens > targetWindow) {
          throw new Error(`Compacted context still needs about ${afterTokens} tokens, exceeding ${provider}/${modelId}'s ${targetWindow}-token window`);
        }
      } finally {
        invalidateSessionListCache();
        host.capabilities.flushPendingProjectCapabilitySettings();
      }
      host.assertSessionIdle("change model");
    }
  }
  await host.inner.setModel(applyConfiguredImageInput(model));
  host.capabilities.reapplySessionCapabilities();
  host.persistSessionFile();
  clearPendingSessionModel(host.sessionId);
  invalidateModelsCache();
  invalidateSessionListCache();
  return { id: model.id, provider: model.provider, compacted };
}

export function handleSetThinkingLevelCommand(host: RpcCommandHost, command: SessionRpcCommand): null {
  const level = command.level as string;
  host.inner.setThinkingLevel(level);
  // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
  // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
  // force the state back so the compat layer can use it correctly.
  if (level === "xhigh" && (host.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && host.inner.agent?.state) {
    host.inner.agent.state.thinkingLevel = "xhigh";
  }
  invalidateSessionListCache();
  return null;
}

export async function handleCompactCommand(host: RpcCommandHost, command: SessionRpcCommand) {
  host.beginRun("compacting", "Compacting conversation context");
  try {
    return await host.withFinalRunningNotification(() =>
      host.inner.compact(command.customInstructions as string | undefined)
    );
  } finally {
    invalidateSessionListCache();
    host.capabilities.flushPendingProjectCapabilitySettings();
  }
}
