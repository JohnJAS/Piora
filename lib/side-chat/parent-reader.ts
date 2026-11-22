import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "../rpc-manager";
import { isDeletedUserMessage } from "../session-message-delete";
import { restorePromptMaterialDisplayPreview } from "../prompt-materials";
import { resolveSessionPath } from "../session-reader";
import type { SessionEntry } from "../types";

const MAX_OUTPUT_CHARS = 24_000;

function extractText(content: unknown): string {
  if (typeof content === "string") return restorePromptMaterialDisplayPreview(content).trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: string; name?: string };
    if (item.type === "text" && typeof item.text === "string") {
      parts.push(restorePromptMaterialDisplayPreview(item.text));
    } else if (item.type === "toolCall" && typeof item.name === "string") {
      parts.push(`[tool_call: ${item.name}]`);
    } else if (item.type === "image") {
      parts.push("[image]");
    }
  }
  return parts.join("\n").trim();
}

function activeBranch(entries: readonly SessionEntry[], leafId?: string | null): SessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let current = leafId ? byId.get(leafId) : entries.at(-1);
  if (!current && leafId !== null) current = entries.at(-1);
  const out: SessionEntry[] = [];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    out.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return out.reverse();
}

/**
 * Read a bounded, read-only summary of recent parent-session turns and live status
 * for `piora_read_parent_session`.
 */
export async function readParentSessionSummary(
  parentSessionId: string,
  options: { maxTurns?: number; includeToolSummaries?: boolean } = {},
): Promise<string> {
  const maxTurns = Math.min(20, Math.max(1, Math.floor(options.maxTurns ?? 8)));
  const includeToolSummaries = options.includeToolSummaries !== false;

  const live = getRpcSession(parentSessionId);
  let entries: SessionEntry[];
  let leafId: string | null;
  let statusLine = "idle (not running in memory)";

  if (live?.isAlive()) {
    const sm = live.inner.sessionManager;
    entries = sm.getEntries() as unknown as SessionEntry[];
    leafId = sm.getLeafId();
    const state = live.getRuntimeState("full") as {
      runtime?: string;
      pendingApproval?: boolean;
      activeTools?: Array<{ name?: string }>;
    };
    const snapshot = live.getTaskRuntimeSnapshot();
    const pendingQuestions = live.getPendingUiRequests().map((req) => req.method);
    statusLine = [
      `runtime=${state.runtime ?? snapshot.runtime}`,
      (state.pendingApproval || snapshot.pendingApproval) ? "pendingApproval=true" : null,
      pendingQuestions.length ? `pendingUi=${pendingQuestions.join(",")}` : null,
      state.activeTools?.length ? `activeTools=${state.activeTools.map((t) => t.name ?? "tool").join(",")}` : null,
    ].filter(Boolean).join(", ");
  } else {
    const filePath = await resolveSessionPath(parentSessionId);
    if (!filePath) return `Parent session ${parentSessionId} was not found.`;
    const sm = SessionManager.open(filePath);
    entries = sm.getEntries() as unknown as SessionEntry[];
    leafId = sm.getLeafId();
  }

  const branch = activeBranch(entries, leafId);
  const turns: Array<{ items: string[] }> = [];
  let currentTurn: { items: string[] } | null = null;

  for (const entry of branch) {
    if (entry.type !== "message" || isDeletedUserMessage(entry)) continue;
    const message = entry.message as { role?: string; content?: unknown; toolName?: string; isError?: boolean };
    if (message.role === "user") {
      currentTurn = { items: [`User: ${extractText(message.content) || "(empty)"}`] };
      turns.push(currentTurn);
      continue;
    }
    if (!currentTurn) {
      currentTurn = { items: [] };
      turns.push(currentTurn);
    }
    if (message.role === "assistant") {
      const text = extractText(message.content);
      if (text) currentTurn.items.push(`Assistant: ${text}`);
    } else if (includeToolSummaries && message.role === "toolResult") {
      const snippet = extractText(message.content).slice(0, 300);
      const tag = message.isError ? "error" : "ok";
      currentTurn.items.push(`ToolResult(${message.toolName ?? "tool"}, ${tag}): ${snippet}`);
    }
  }

  const recentTurns = turns.slice(-maxTurns);
  const lines = [
    `Parent session ${parentSessionId}`,
    `Live status: ${statusLine}`,
    `Showing last ${recentTurns.length} of ${turns.length} turn(s):`,
    "",
  ];
  recentTurns.forEach((turn, index) => {
    lines.push(`--- Turn ${turns.length - recentTurns.length + index + 1} ---`);
    lines.push(...turn.items);
    lines.push("");
  });

  const combined = lines.join("\n").trim();
  if (combined.length <= MAX_OUTPUT_CHARS) return combined;
  return `${combined.slice(0, MAX_OUTPUT_CHARS)}\n\n...[truncated to ${MAX_OUTPUT_CHARS} characters]`;
}
