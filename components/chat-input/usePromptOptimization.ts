"use client";

import React, { useCallback, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { readPromptOptimizerModel, readPromptOptimizerSystemPrompt } from "@/lib/prompt-optimizer-settings";
import type { PromptOptimizationState } from "./shared";

export interface UsePromptOptimizationOptions {
  value: string;
  valueRef: React.MutableRefObject<string>;
  cwd?: string | null;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  isStreaming: boolean;
}

export function usePromptOptimization({
  value,
  valueRef,
  cwd,
  model,
  isAutoModelSelection,
  isStreaming,
}: UsePromptOptimizationOptions) {
  const { t } = useI18n();
  const [promptOptimization, setPromptOptimization] = useState<PromptOptimizationState | null>(null);
  const promptOptimizerAbortRef = useRef<AbortController | null>(null);

  const resetPromptOptimization = useCallback(() => {
    promptOptimizerAbortRef.current?.abort();
    promptOptimizerAbortRef.current = null;
    setPromptOptimization(null);
  }, []);

  const handleOptimizePrompt = useCallback(async () => {
    const source = value.trim();
    const configuredModel = readPromptOptimizerModel(window.localStorage);
    const optimizerModel = configuredModel ?? (model ? { provider: model.provider, modelId: model.modelId } : null);
    if (!source || !optimizerModel || isAutoModelSelection || isStreaming || source.startsWith("/") || source.startsWith("!")) return;

    promptOptimizerAbortRef.current?.abort();
    const controller = new AbortController();
    promptOptimizerAbortRef.current = controller;
    setPromptOptimization({ source, loading: true });

    try {
      const response = await fetch("/api/prompts/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: source,
          provider: optimizerModel.provider,
          modelId: optimizerModel.modelId,
          cwd: cwd ?? undefined,
          systemPrompt: readPromptOptimizerSystemPrompt(window.localStorage),
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as { optimizedPrompt?: unknown; error?: unknown };
      if (!response.ok || typeof payload.optimizedPrompt !== "string" || !payload.optimizedPrompt.trim()) {
        const message = typeof payload.error === "string" ? payload.error : t("chat.optimizePromptFailed");
        throw new Error(message);
      }
      if (valueRef.current.trim() !== source) return;
      setPromptOptimization({ source, loading: false, result: payload.optimizedPrompt.trim() });
    } catch (error) {
      if (controller.signal.aborted || valueRef.current.trim() !== source) return;
      setPromptOptimization({
        source,
        loading: false,
        error: error instanceof Error ? error.message : t("chat.optimizePromptFailed"),
      });
    } finally {
      if (promptOptimizerAbortRef.current === controller) promptOptimizerAbortRef.current = null;
    }
  }, [cwd, isAutoModelSelection, isStreaming, model, t, value, valueRef]);

  return {
    promptOptimization,
    setPromptOptimization,
    promptOptimizerAbortRef,
    resetPromptOptimization,
    handleOptimizePrompt,
  };
}
