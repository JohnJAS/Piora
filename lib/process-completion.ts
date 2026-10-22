import type { AgentMessage, ToolResultMessage } from "./types";
import { hasAssistantNotice } from "./message-display";

/** Only settled, successful turns may fold themselves. Missing results remain visible. */
export function completedProcessTurns(messages: AgentMessage[], active: boolean): boolean[] {
  const completed = new Array<boolean>(messages.length).fill(false);
  const results = new Map<string, ToolResultMessage>();
  for (const message of messages) if (message.role === "toolResult") results.set(message.toolCallId, message);
  for (let start = 0; start < messages.length;) {
    let end = start + 1;
    while (end < messages.length) {
      const next = messages[end];
      if (next.role === "user" || next.role === "custom" && next.customType === "compaction") break;
      end++;
    }
    let success = !(active && end === messages.length);
    for (let index = start; success && index < end; index++) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      if (hasAssistantNotice(message)) { success = false; break; }
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        const result = results.get(block.toolCallId);
        if (!result || result.isStreaming || result.isError
          || block.toolName === "browser" && block.input?.action === "wait_for_user"
            && (result.details as { status?: string } | undefined)?.status === "unsupported") {
          success = false;
          break;
        }
      }
    }
    completed.fill(success, start, end);
    start = end;
  }
  return completed;
}
