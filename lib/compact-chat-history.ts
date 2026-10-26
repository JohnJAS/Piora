import type { AgentMessage, AssistantMessage, AssistantContentBlock, ToolResultMessage } from "./types";
import type { ChatHistoryRow } from "./chat-history";
import { isEmptyThinkingBlock, hasAssistantNotice } from "./message-display";
import { isCommandToolName, toolResultText } from "./command-execution";
import { toolActivityKind, type ToolActivityKind } from "./tool-activity";

export interface ToolActivityGroup {
  kind: ToolActivityKind;
  count: number;
  expanded: boolean;
  active: boolean;
  attention: boolean;
}

export interface ProcessStep {
  key: string;
  block: AssistantContentBlock;
  status: "running" | "done" | "unknown" | "error";
  output?: string;
}

export interface CompactProcessGroup {
  active: boolean;
  expanded: boolean;
  count: number;
  startedAt?: number;
  endedAt?: number;
  attention: boolean;
  preview: ProcessStep[];
  activities: Partial<Record<"read" | "search" | "command" | "edit" | "thinking" | "other", number>>;
}

/** A short, plain-text tail. The full log stays available in the command viewer. */
export function commandPreviewTail(output: string): string {
  return output.slice(-6000)
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "")
    .replace(/\r(?!\n)/g, "\n").trimEnd().split("\n").slice(-3)
    .map((line) => line.length > 240 ? `${line.slice(0, 240)}…` : line).join("\n");
}

function needsAttention(block: AssistantContentBlock, results: Map<string, ToolResultMessage>, active: boolean): boolean {
  if (block.type !== "toolCall") return false;
  const result = results.get(block.toolCallId);
  if (result?.isError) return true;
  if (!active && (!result || result.isStreaming)) return true;
  // User handoff remains actionable even while the surrounding process is folded.
  return block.toolName === "browser" && block.input?.action === "wait_for_user"
    && (!result || result.isStreaming === true || (result.details as { status?: string } | undefined)?.status === "unsupported");
}

/** Both display modes share turn boundaries. Only running defaults differ. */
export function buildCompactChatHistoryRows(
  messages: AgentMessage[], entryIds: string[], busy: boolean,
  choices: ReadonlyMap<string, boolean>, streamingIndex = -1, compact = false,
) {
  const rows: ChatHistoryRow[] = [];
  const entryRows = new Map<string, string>();
  const entryGroups = new Map<string, string>();
  const entryActivities = new Map<string, string[]>();
  const commandActivities = new Map<string, string>();
  const results = new Map<string, ToolResultMessage>();
  for (const message of messages) if (message.role === "toolResult") results.set(message.toolCallId, message);
  for (let start = 0; start < messages.length;) {
    let end = start + 1;
    // Compaction and custom status cards can occur within one user turn.
    while (end < messages.length && messages[end].role !== "user") end++;
    const active = busy && end === messages.length;
    const anchor = messages[start];
    const key = `compact-process:${entryIds[start] || (anchor.role === "user" ? anchor.clientPromptId : undefined) || start}`;
    const turnRows: ChatHistoryRow[] = [];
    const steps: ProcessStep[] = [];
    const activities: CompactProcessGroup["activities"] = {};
    let attention = false;
    for (let i = start; i < end; i++) {
      const message = messages[i];
      if (message.role === "toolResult") continue;
      const rowKey = `message:${entryIds[i] || (message.role === "user" ? message.clientPromptId : undefined) || i}`;
      if (message.role !== "assistant") {
        turnRows.push({ key: rowKey, index: i, message });
        continue;
      }
      attention ||= i !== streamingIndex && hasAssistantNotice(message);
      const content = Array.isArray(message.content) ? message.content : [];
      const segments: Array<{ offset: number; process: boolean; activity?: ToolActivityKind; blocks: AssistantContentBlock[] }> = [];
      for (const [b, original] of content.entries()) {
        if (Boolean(isEmptyThinkingBlock(original, { isStreaming: i === streamingIndex }))) continue;
        // Splitting rows must not change deferred lookup or disclosure identities.
        const block = original.type === "thinking" ? { ...original, deferredBlockIndex: original.deferredBlockIndex ?? b } : original;
        const process = block.type === "thinking" || block.type === "toolCall";
        const activity = block.type === "toolCall" ? toolActivityKind(block.toolName) : undefined;
        const previous = segments.at(-1);
        if (previous?.process === process && previous.activity === activity) previous.blocks.push(block);
        else segments.push({ offset: b, process, activity, blocks: [block] });
        if (process) {
          attention ||= needsAttention(block, results, active);
          const result = block.type === "toolCall" ? results.get(block.toolCallId) : undefined;
          const status = block.type === "toolCall" ? result?.isError ? "error" : result && !result.isStreaming ? "done" : active ? "running" : "unknown"
            : i === streamingIndex && b === content.length - 1 ? "running" : "done";
          steps.push({ key: `${rowKey}:${b}`, block, status,
            output: block.type === "toolCall" && isCommandToolName(block.toolName) && result?.isStreaming ? commandPreviewTail(toolResultText(result)) : undefined });
          const kind = block.type === "thinking" ? "thinking" : block.type !== "toolCall" ? "other"
            : isCommandToolName(block.toolName) ? "command" : block.toolName === "read" ? "read"
              : ["grep", "find", "ls"].includes(block.toolName) ? "search" : ["edit", "write"].includes(block.toolName) ? "edit" : "other";
          activities[kind] = (activities[kind] ?? 0) + 1;
        }
      }
      if (!segments.length && hasAssistantNotice(message)) turnRows.push({ key: rowKey, index: i, message });
      for (const [s, segment] of segments.entries()) {
        const last = s === segments.length - 1;
        turnRows.push({ key: `${rowKey}:${segment.offset}`, index: i, secondary: segment.process,
          processGroupKey: segment.process ? key : undefined, attachRef: last,
          toolActivityKind: segment.activity,
          intermediate: !last || segment.process, isStreaming: i === streamingIndex && last,
          message: { ...message, content: segment.blocks, ...(!last ? { usage: undefined, stopReason: undefined, errorMessage: undefined } : {}) } as AssistantMessage });
        if (segment.process && entryIds[i]) entryGroups.set(entryIds[i], key);
      }
    }
    // Latest completed turn stays open until another input; exceptional turns
    // never hide their evidence, even after a previous manual collapse.
    const open = attention || (choices.get(key) ?? (end === messages.length && (!active || !compact)));
    // Keep each tool row virtualized. Summary rows only group contiguous tools
    // of the same kind; thinking, prose and custom notices break the group.
    const groupedRows: ChatHistoryRow[] = [];
    const closedActivities = new Set<string>();
    for (let j = 0; j < turnRows.length;) {
      const first = turnRows[j];
      if (!first.toolActivityKind) { groupedRows.push(first); j++; continue; }
      let k = j + 1;
      while (k < turnRows.length && turnRows[k].toolActivityKind === first.toolActivityKind) k++;
      const activityKey = `tool-activity:${first.key}`;
      let groupAttention = false, groupActive = false, count = 0;
      const paths = new Set<string>();
      for (const row of turnRows.slice(j, k)) {
        row.toolActivityKey = activityKey;
        const id = entryIds[row.index];
        if (id) {
          const groups = entryActivities.get(id) ?? [];
          if (groups.at(-1) !== activityKey) groups.push(activityKey);
          entryActivities.set(id, groups);
        }
        const content = row.message?.role === "assistant" ? row.message.content : undefined;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (block.type !== "toolCall") continue;
          count++;
          paths.add(typeof block.input?.path === "string" ? block.input.path : block.toolCallId);
          commandActivities.set(block.toolCallId, activityKey);
          groupAttention ||= needsAttention(block, results, active);
          const result = results.get(block.toolCallId);
          groupActive ||= active && (!result || Boolean(result.isStreaming));
        }
      }
      const expanded = groupAttention || (choices.get(activityKey) ?? true);
      if (!expanded) closedActivities.add(activityKey);
      groupedRows.push({ key: activityKey, index: first.index, processGroupKey: key,
        toolActivity: { kind: first.toolActivityKind, count: ["read", "directory", "edit"].includes(first.toolActivityKind) ? paths.size : count,
          expanded, active: groupActive, attention: groupAttention } });
      groupedRows.push(...turnRows.slice(j, k));
      j = k;
    }
    let headingAdded = false;
    const timestamps = messages.slice(start, end).map(message => message.timestamp).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    for (const row of groupedRows) {
      if ((row.secondary || row.toolActivity) && !headingAdded) {
        rows.push({ key, index: row.index - 0.1, compactProcess: { active, expanded: open, count: steps.length, attention, activities,
          startedAt: timestamps[0], endedAt: active ? undefined : timestamps.at(-1), preview: steps.slice(-3) } });
        headingAdded = true;
      }
      if (row.toolActivity) { if (open) rows.push(row); continue; }
      const id = entryIds[row.index];
      const activityClosed = row.toolActivityKey && closedActivities.has(row.toolActivityKey);
      if (id && (!entryRows.has(id) || entryRows.get(id) === key || entryRows.get(id)?.startsWith("tool-activity:"))) {
        entryRows.set(id, row.secondary && !open ? key : activityClosed ? row.toolActivityKey! : row.key);
      }
      if (!row.secondary || open && !activityClosed) rows.push(row);
    }
    start = end;
  }
  return { rows, entryRows, entryGroups, entryActivities, commandActivities };
}
