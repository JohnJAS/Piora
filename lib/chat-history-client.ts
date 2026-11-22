import { mergePendingPrompts, readPendingPrompts } from "./prompt-recovery";
import type { SessionContext } from "./types";

export interface ChatHistoryResource {
  context: SessionContext;
  leafId: string | null;
  persistedPromptIds?: string[];
}

export function chatHistoryUrl(sessionId: string, branch?: { leafId: string | null }): string {
  const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1", view: "transcript" });
  if (branch?.leafId) params.set("leafId", branch.leafId);
  return "/api/sessions/" + encodeURIComponent(sessionId) + (branch ? "/context?" : "?") + params;
}

export async function restoreChatHistory(sessionId: string, resource: ChatHistoryResource, signal?: AbortSignal) {
  const { context, leafId, persistedPromptIds } = resource;
  const entryIds = context.entryIds ?? [];
  const pending = await readPendingPrompts(sessionId);
  if (!pending.length) return { messages: context.messages, entryIds, confirmedIds: [] };
  if (persistedPromptIds) return mergePendingPrompts(context.messages, entryIds, pending, persistedPromptIds);
  const retired = new Set<string>();
  const anchors = new Set<string>();
  const displayed = new Set(entryIds);
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
  return mergePendingPrompts(context.messages, entryIds, pending, [...retired], [...anchors]);
}
