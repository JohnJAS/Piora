"use client";

import { createContext } from "react";
import { messageImageUrl } from "@/lib/message-images";
import type {
  AgentMessage,
  AssistantMessage,
  CustomMessage,
  ImageContent,
  TextContent,
  ToolCallContent,
  ToolResultMessage,
  UserMessage,
} from "@/lib/types";

export const HistoryModeContext = createContext(false);
export const HistoryVersionContext = createContext<string | undefined>(undefined);
export const ToolRunActiveContext = createContext(false);

const MAX_THINKING_CACHE_ENTRIES = 100;
const THINKING_LOAD_TIMEOUT_MS = 15_000;
const USER_MESSAGE_COLLAPSE_LINE_THRESHOLD = 12;
const USER_MESSAGE_PREVIEW_LINES = 8;
const USER_MESSAGE_COLLAPSE_CHAR_THRESHOLD = 2_400;
const USER_MESSAGE_PREVIEW_CHARS = 1_800;

type ThinkingCacheEntry = { promise: Promise<string> };
const thinkingContentCache = new Map<string, ThinkingCacheEntry>();

export function getUserMessagePreview(content: string): { collapsible: boolean; preview: string; lineCount: number } {
  const lines = content.split(/\r\n|\r|\n/);
  const collapsible = lines.length > USER_MESSAGE_COLLAPSE_LINE_THRESHOLD
    || content.length > USER_MESSAGE_COLLAPSE_CHAR_THRESHOLD;
  if (!collapsible) return { collapsible: false, preview: content, lineCount: lines.length };

  const linePreview = lines.slice(0, USER_MESSAGE_PREVIEW_LINES).join("\n");
  const preview = linePreview.length > USER_MESSAGE_PREVIEW_CHARS
    ? `${linePreview.slice(0, USER_MESSAGE_PREVIEW_CHARS).trimEnd()}…`
    : linePreview;
  return { collapsible: true, preview, lineCount: lines.length };
}

export function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number, historyVersion?: string): Promise<string> {
  const key = `${sessionId}:${entryId}:${blockIndex}:${historyVersion ?? "chat"}`;
  const cached = thinkingContentCache.get(key);
  if (cached) {
    thinkingContentCache.delete(key);
    thinkingContentCache.set(key, cached);
    return cached.promise;
  }

  const cacheEntry = {} as ThinkingCacheEntry;
  const request = (async () => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, THINKING_LOAD_TIMEOUT_MS);
    try {
      const response = await fetch(
        historyVersion
          ? `/api/sessions/${encodeURIComponent(sessionId)}/history/content?${new URLSearchParams({ entryId, blockIndex: String(blockIndex), kind: "thinking", version: historyVersion })}`
          : `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const data = await response.json() as { thinking?: unknown };
      if (typeof data.thinking !== "string") throw new Error("Invalid thinking response");
      return data.thinking;
    } catch (error) {
      if (timedOut) throw new Error("Thinking content request timed out");
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  })().catch((error) => {
    if (thinkingContentCache.get(key) === cacheEntry) {
      thinkingContentCache.delete(key);
    }
    throw error;
  });

  cacheEntry.promise = request;
  thinkingContentCache.set(key, cacheEntry);
  if (thinkingContentCache.size > MAX_THINKING_CACHE_ENTRIES) {
    const oldestKey = thinkingContentCache.keys().next().value;
    if (oldestKey) thinkingContentCache.delete(oldestKey);
  }
  return request;
}

export function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

export function haveSameRelevantToolResults(
  message: AgentMessage,
  previous: Pick<ReadonlyMap<string, ToolResultMessage>, "get"> | undefined,
  next: Pick<ReadonlyMap<string, ToolResultMessage>, "get"> | undefined,
): boolean {
  if (previous === next || message.role !== "assistant") return true;
  for (const block of (message as AssistantMessage).content ?? []) {
    if (block?.type === "toolCall" && previous?.get(block.toolCallId) !== next?.get(block.toolCallId)) {
      return false;
    }
  }
  return true;
}

export function getAutomationToolCardDetails(
  block: Pick<ToolCallContent, "toolName" | "input">,
  result: ToolResultMessage | undefined,
): { id: string; name?: string; rrule?: string } | null {
  if (block.toolName !== "piora_automation" || (block.input as { action?: unknown })?.action !== "create" || result?.isError) {
    return null;
  }
  const automation = (result?.details as { automation?: { id?: unknown; name?: unknown; rrule?: unknown } } | undefined)?.automation;
  if (typeof automation?.id !== "string") return null;
  return {
    id: automation.id,
    ...(typeof automation.name === "string" ? { name: automation.name } : {}),
    ...(typeof automation.rrule === "string" ? { rrule: automation.rrule } : {}),
  };
}

export function getMessageText(content: CustomMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is TextContent => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

export function getMessageImages(content: CustomMessage["content"] | UserMessage["content"]): ImageContent[] {
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is ImageContent => b?.type === "image");
}

export function imageSource(img: ImageContent): string {
  return messageImageUrl(img);
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatCustomType(type: string): string {
  return typeof type === "string" && type ? type : "extension";
}

export function previewText(text: string): string {
  if (typeof text !== "string") return "Show extension message";
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Show extension message";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}
