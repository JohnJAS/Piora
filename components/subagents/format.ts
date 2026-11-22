"use client";

import { useEffect, useState } from "react";
import { fetchSubagent, type SubagentDetailResponse } from "@/hooks/useSubagents";
import { truncatedSubagentResultPrefix, type SubagentDetail, type SubagentListItem, type SubagentStatus } from "@/lib/subagent-types";

export function subagentElapsedSeconds(record: Pick<SubagentListItem, "startedAt" | "attemptStartedAt" | "endedAt">, now = Date.now()): number {
  const start = record.attemptStartedAt ?? record.startedAt;
  const end = record.endedAt ?? now;
  return Math.max(0, Math.round((end - start) / 1_000));
}

export function formatSubagentDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe}s`;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
}

export function formatSubagentTokens(tokens: number): string {
  const safe = Math.max(0, Math.round(tokens));
  if (safe < 1_000) return String(safe);
  if (safe < 1_000_000) {
    const k = safe / 1_000;
    return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k`;
  }
  return `${Number((safe / 1_000_000).toFixed(2))}M`;
}

export function useLiveSubagentElapsed(record?: Pick<SubagentListItem, "status" | "startedAt" | "attemptStartedAt" | "endedAt">): number {
  const isRunning = record?.status === "running" && record.endedAt === undefined;
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    setTick(Date.now());
    const id = window.setInterval(() => setTick(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [isRunning, record?.attemptStartedAt, record?.startedAt]);
  if (!record) return 0;
  return subagentElapsedSeconds(record, isRunning ? tick : record.endedAt ?? tick);
}

export function formatSubagentModelName(model?: string): string | undefined {
  if (!model) return undefined;
  const slash = model.indexOf("/");
  if (slash <= 0) return model;
  return model.slice(slash + 1);
}

export function describeSubagentToolCall(
  toolName: string | undefined,
  input: Record<string, unknown> | undefined,
  record: SubagentDetail | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): { title: string; actionLabel?: string } {
  if (toolName === "SendMessage") {
    const messageSnippet = typeof input?.message === "string"
      ? input.message.replace(/\s+/gu, " ").trim().slice(0, 72)
      : undefined;
    return {
      title: record?.description || messageSnippet || t("subagent.action.continue"),
      actionLabel: t("subagent.action.continue"),
    };
  }
  if (toolName === "TaskOutput") {
    return {
      title: record?.description || t("subagent.action.output"),
      actionLabel: t("subagent.action.output"),
    };
  }
  if (toolName === "TaskStop") {
    return {
      title: record?.description || t("subagent.action.stop"),
      actionLabel: t("subagent.action.stop"),
    };
  }
  const description = typeof input?.description === "string" && input.description.trim()
    ? input.description.trim()
    : undefined;
  return {
    title: record?.description ?? description ?? t("subagent.title"),
  };
}

export function parseSubagentCompletionText(rawText: string, fallback?: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) return fallback ?? "";
  const match = trimmed.match(/^<subagent-notification>\s*([\s\S]*?)\s*<\/subagent-notification>$/u);
  if (!match) return trimmed;
  const lines = match[1].split(/\r?\n/u);
  let start = 0;
  // Strip the machine-generated header lines ("<desc>: <status>" and "agentId: ...")
  if (lines[start] && /:\s*(running|completed|failed|cancelled|interrupted)\s*$/u.test(lines[start])) {
    start++;
  }
  if (lines[start] && /^agentId:\s*\S+/u.test(lines[start])) {
    start++;
  }
  const body = lines.slice(start).join("\n").trim();
  return body || fallback || match[1].trim();
}

export function buildContinueSubagentPrompt(record: SubagentDetail, locale: string): string {
  const isZh = locale.toLowerCase().startsWith("zh");
  if (isZh) {
    return `请使用 SendMessage 继续子代理 ${record.agentId}（${record.description}），补充任务：`;
  }
  return `Continue subagent ${record.agentId} (${record.description}) via SendMessage with this follow-up: `;
}

export function isSubagentResultTruncated(record: Pick<SubagentDetail, "result" | "resultTruncated">, fallbackText = ""): boolean {
  return Boolean(
    record.resultTruncated
      || truncatedSubagentResultPrefix(record.result) !== undefined
      || (fallbackText && truncatedSubagentResultPrefix(fallbackText) !== undefined),
  );
}

export async function resolveSubagentCopyText({
  record,
  fallbackText,
  canFetchFull,
  cachedFull,
}: {
  record: Pick<SubagentDetail, "parentSessionId" | "agentId" | "attempt" | "result" | "resultTruncated">;
  fallbackText: string;
  canFetchFull: boolean;
  cachedFull?: string | null;
}): Promise<{ text: string; copiedSummaryFallback: boolean; recoveredFull?: string | null }> {
  if (typeof cachedFull === "string") {
    return { text: cachedFull, copiedSummaryFallback: false, recoveredFull: cachedFull };
  }
  const truncated = isSubagentResultTruncated(record, fallbackText);
  if (!truncated) {
    return { text: fallbackText, copiedSummaryFallback: false };
  }
  if (!canFetchFull || cachedFull === null) {
    return { text: fallbackText, copiedSummaryFallback: true, recoveredFull: cachedFull ?? null };
  }
  try {
    const query = new URLSearchParams({ agentId: record.agentId, fullResult: "true" }).toString();
    const response = await fetchSubagent<SubagentDetailResponse>(
      record.parentSessionId,
      query,
      AbortSignal.timeout(10_000),
    );
    if (response.records[0]?.attempt === record.attempt && typeof response.fullResult === "string") {
      return { text: response.fullResult, copiedSummaryFallback: false, recoveredFull: response.fullResult };
    }
    return { text: fallbackText, copiedSummaryFallback: true, recoveredFull: null };
  } catch {
    return { text: fallbackText, copiedSummaryFallback: true };
  }
}

export function statusIconName(status?: SubagentStatus): "activity" | "check-circle" | "error" | "stop" | "warning" {
  switch (status) {
    case "completed": return "check-circle";
    case "failed": return "error";
    case "cancelled": return "stop";
    case "interrupted": return "warning";
    default: return "activity";
  }
}
