import { createChatCommandOperation, parseChatInput } from "./chat-command-input";
import type { ChatCommandCatalog, ChatCommandView } from "./chat-command-types";
import type { PendingPrompt } from "./prompt-recovery";

export const isTerminalCommandStatus = (status: string) => ["completed", "failed", "cancelled", "expired", "interrupted"].includes(status);

export function mergeChatCommandViews(current: ChatCommandView[], incoming: ChatCommandView[]): ChatCommandView[] {
  const records = new Map(current.map(record => [record.commandId, record]));
  for (const record of incoming) {
    const sameSubmission = [...records.values()].find(existing => existing.idempotencyKey === record.idempotencyKey);
    if (record.local && sameSubmission && !sameSubmission.local) continue;
    for (const [key, existing] of records) {
      if (existing.local && existing.idempotencyKey === record.idempotencyKey && !record.local) records.delete(key);
    }
    const previous = records.get(record.commandId);
    if (previous?.revision !== undefined && (record.revision === undefined || record.revision < previous.revision)) continue;
    if (previous && isTerminalCommandStatus(previous.status) && !isTerminalCommandStatus(record.status)) continue;
    records.set(record.commandId, { ...previous, ...record });
  }
  return [...records.values()].sort((left, right) => left.acceptedAt - right.acceptedAt);
}

export function recoverChatCommandViews(pending: PendingPrompt[], catalog: ChatCommandCatalog, sessionId: string | null): ChatCommandView[] {
  return pending.filter(record => record.message.commandSubmission).map(record => {
    const parsed = parseChatInput(record.draft.value, catalog, record.draft.commandInput);
    return {
      commandId: `pending-${record.id}`,
      idempotencyKey: record.id,
      targetSessionId: sessionId ?? "",
      acceptedAt: record.message.timestamp ?? 0,
      status: "interrupted",
      ...(parsed.kind === "command" ? { operation: createChatCommandOperation(record.draft.value, catalog, parsed, record.draft.commandInput) } : {}),
      preview: record.draft.value,
      attachments: record.draft.images.length + record.draft.files.length,
      local: true,
    };
  });
}
