import type { ModelChangeNotice } from "./model-change-notices";
import { mergePendingPrompts, readPendingPrompts } from "./prompt-recovery";
import type { SessionHistoryPage } from "./session-read-repository";
import type { AgentMessage, SessionContext } from "./types";

export interface ChatHistoryResource {
  context: SessionContext;
  leafId: string | null;
  historyPage?: SessionHistoryPage;
  persistedPromptIds?: string[];
}

export interface LoadedChatHistory {
  messages: AgentMessage[];
  entryIds: string[];
  modelChanges: ModelChangeNotice[];
  historyPage?: SessionHistoryPage;
}

export function chatHistoryUrl(sessionId: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1", view: "chat", ...extra });
  return "/api/sessions/" + encodeURIComponent(sessionId) + "?" + params;
}

export async function restoreChatHistory(sessionId: string, resource: ChatHistoryResource, signal?: AbortSignal) {
  const { context, historyPage, leafId } = resource;
  const pending = await readPendingPrompts(sessionId);
  if (!pending.length || !historyPage) return mergePendingPrompts(context.messages, context.entryIds ?? [], pending, resource.persistedPromptIds);
  const retired = new Set<string>();
  const anchors = new Set<string>();
  const displayed = new Set(context.entryIds);
  for (let offset = 0; offset < pending.length; offset += 128) {
    if (signal?.aborted) throw signal.reason;
    const records = pending.slice(offset, offset + 128);
    const ids = records.map(record => record.id);
    const missing = records.flatMap(record => record.branchAnchorId && !displayed.has(record.branchAnchorId) ? [record.branchAnchorId] : []);
    const response = await fetch("/api/sessions/" + encodeURIComponent(sessionId) + "/receipts", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ ids, anchors: [...new Set(missing)], leafId }),
    }).catch(error => {
      if (signal?.aborted) throw error;
      return null;
    });
    if (!response?.ok) continue;
    const result = await response.json() as { persistedPromptIds: string[]; activeAnchorIds: string[] };
    for (const id of result.persistedPromptIds) retired.add(id);
    for (const id of result.activeAnchorIds) anchors.add(id);
  }
  return mergePendingPrompts(context.messages, context.entryIds, pending, [...retired], [...anchors]);
}

export function combineOlderHistory(older: ChatHistoryResource, current: LoadedChatHistory): LoadedChatHistory | null {
  if (!older.historyPage || !current.historyPage || older.historyPage.contextVersion !== current.historyPage.contextVersion) return null;
  const seen = new Set(current.entryIds.filter(Boolean));
  const olderIds: string[] = [];
  const olderMessages: AgentMessage[] = [];
  older.context.entryIds.forEach((id, index) => {
    if (seen.has(id)) return;
    olderIds.push(id);
    olderMessages.push(older.context.messages[index]);
  });
  const modelChanges = new Map([...older.context.modelChanges ?? [], ...current.modelChanges].map(notice => [notice.id, notice]));
  return {
    messages: [...olderMessages, ...current.messages], entryIds: [...olderIds, ...current.entryIds], modelChanges: [...modelChanges.values()],
    historyPage: { ...older.historyPage, focused: current.historyPage.focused },
  };
}
