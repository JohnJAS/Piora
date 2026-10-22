"use client";
import { memo, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type Ref, type RefObject } from "react";
import { CompactProcessSummary } from "./CompactProcessSummary";
import { buildCompactChatHistoryRows } from "@/lib/compact-chat-history";
import { CompactProcessContext, RevealProcessCommandContext } from "./CompactProcessContext";
import { buildChatHistoryRows, insertCommandHistoryRows, layoutChatResponseRows, messageFingerprint, type ChatHistoryRow } from "@/lib/chat-history";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { MessageView } from "./MessageView";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import { AliIcon } from "./AliIcon";
import { ChatDisclosureTrigger } from "./ChatDisclosure";
import { getDisplayableAssistantBlocks, hasAssistantNotice } from "@/lib/message-display";
import { ProcessCompletedContext, ProcessStackContext } from "./ProcessStack";
import { completedProcessTurns } from "@/lib/process-completion";
import { processTimeRange, type ProcessTimeRange } from "@/lib/process-duration";
import { VirtualList, type VirtualListHandle } from "./VirtualList";
import { ChatCommandCard, type ChatCommandCardActions } from "./ChatCommandCard";
import type { ChatCommandView } from "@/lib/chat-command-types";

export interface ChatHistoryHandle { revealEntry(id: string): void; cancelNavigation(): void }
interface ProcessStackGroup {
  key: string;
  choiceKey: string;
  last: string;
  count: number;
  completed: boolean;
  timeRanges: Array<ProcessTimeRange | undefined>;
}

function buildProcessStacks(rows: ChatHistoryRow[], messages: AgentMessage[], entryIds: string[], completedTurns: boolean[], sessionId?: string) {
  const groups = new Map<string, ProcessStackGroup>();
  const results = new Map<string, ToolResultMessage>();
  for (const message of messages) if (message.role === "toolResult") results.set(message.toolCallId, message);
  let group: ProcessStackGroup | undefined;
  for (const row of rows) {
    const message = row.message;
    const blocks = message?.role === "assistant" && !hasAssistantNotice(message) ? getDisplayableAssistantBlocks(message) : [];
    if (!blocks.length || !blocks.every(block => block.type === "thinking" || block.type === "toolCall")) {
      group = undefined;
      continue;
    }
    group ??= { key: row.key, choiceKey: `${sessionId ?? ""}:${entryIds[row.index] || row.index}`, last: row.key, count: 0, completed: completedTurns[row.index], timeRanges: [] };
    group.last = row.key;
    group.count += blocks.length;
    group.timeRanges.push(processTimeRange(blocks, message?.timestamp, messages[row.index - 1]?.timestamp, results));
    groups.set(row.key, group);
  }
  return groups;
}

type MessageProps = ComponentProps<typeof MessageView>;
interface Props extends Pick<MessageProps, "modelNames" | "cwd" | "onOpenFile" | "onFork" | "onNavigate" | "onEditContent" | "onRetry" | "retryDisabled" | "sessionId" | "onOpenAutomation" | "onOpenCommandExecution"> {
  messages: AgentMessage[];
  compactProcess?: boolean;
  streamingMessage?: AgentMessage | null;
  entryIds: string[];
  busy: boolean;
  streaming: boolean;
  isNew: boolean;
  forkingEntryId: string | null;
  highlightedEntryId: string | null;
  lastUserMsgRef: RefObject<HTMLDivElement | null>;
  pendingScrollToUserRef: RefObject<boolean>;
  scrollContainer: RefObject<HTMLDivElement | null>;
  handleRef: Ref<ChatHistoryHandle>;
  onDeleteMessage?: (message: AgentMessage, entryId?: string) => Promise<void>;
  deleteDisabled?: boolean;
  operations?: ChatCommandView[];
  commandActions?: ChatCommandCardActions;
}

function DeleteMessageAction({ message, entryId, onDelete, disabled }: { message: AgentMessage; entryId?: string; onDelete: NonNullable<Props["onDeleteMessage"]>; disabled: boolean }) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  return <span className="message-delete-action" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
    <button type="button" disabled={disabled || deleting} title={disabled ? t("chat.deleteMessageBusy") : t("chat.deleteMessage")}
      onClick={() => { if (disabled || deleting) return; setDeleting(true); setError(""); void onDelete(message, entryId).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setDeleting(false)); }}
      className="message-delete-button">
      <AliIcon name="delete" size={11} />{t(deleting ? "chat.deletingMessage" : "chat.deleteMessage")}
    </button>
    {error ? <span role="alert" style={{ fontSize: "var(--text-xs)", color: "var(--status-failed)" }}>{error}</span> : null}
  </span>;
}

/** Compact mode combines the live tail with the process; classic mode keeps it in ChatWindow. */
export const ChatHistory = memo(function ChatHistory({ messages: savedMessages, compactProcess = false, streamingMessage, entryIds, busy, streaming, isNew, forkingEntryId, highlightedEntryId, lastUserMsgRef, pendingScrollToUserRef, scrollContainer, handleRef, onDeleteMessage, deleteDisabled = false, operations = [], commandActions, ...messageProps }: Props) {
  const { t } = useI18n();
  const messages = useMemo(() => compactProcess && streamingMessage ? [...savedMessages, streamingMessage] : savedMessages, [compactProcess, savedMessages, streamingMessage]);
  const streamingIndex = compactProcess && streamingMessage ? messages.length - 1 : -1;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [inspectCommand, setInspectCommand] = useState<string | null>(null);
  const list = useRef<VirtualListHandle>(null);
  const { rows, entryRows } = useMemo(() => {
    const plan = compactProcess ? buildCompactChatHistoryRows(messages, entryIds, busy || streaming, expanded, streamingIndex) : buildChatHistoryRows(messages, entryIds, busy || streaming, expanded);
    return { ...plan, rows: layoutChatResponseRows(insertCommandHistoryRows(plan.rows, messages, entryIds, operations), messages, busy || streaming) };
  }, [messages, entryIds, busy, streaming, expanded, compactProcess, streamingIndex, operations]);
  const [stackChoices, setStackChoices] = useState<Map<string, boolean>>(() => new Map());
  const completedTurns = useMemo(() => completedProcessTurns(messages, busy || streaming), [messages, busy, streaming]);
  const processStacks = useMemo(() => buildProcessStacks(compactProcess ? [] : rows, messages, entryIds, completedTurns, messageProps.sessionId),
    [rows, compactProcess, completedTurns, entryIds, messageProps.sessionId, messages]);
  const visibleRows = useMemo(() => rows.filter(row => {
    const group = processStacks.get(row.key);
    return !group || row.key === group.key || (stackChoices.get(group.choiceKey) ?? !group.completed);
  }), [rows, processStacks, stackChoices]);
  const keys = useMemo(() => visibleRows.map((row) => row.key), [visibleRows]);
  const pendingReveal = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (pendingReveal.current && keys.includes(pendingReveal.current)) {
      list.current?.scrollToKey(pendingReveal.current);
      pendingReveal.current = null;
    }
  }, [keys]);
  const metadata = useMemo(() => {
    const toolResults = new Map<string, ToolResultMessage>();
    const userIndices = new Map<number, number>();
    const responseStarts = new Map<number, number>();
    const showTimestamps = new Set<number>();
    let lastUser = -1;
    let lastAssistant = -1;
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message.role === "toolResult") toolResults.set(message.toolCallId, message);
      if (message.role === "user") {
        userIndices.set(i, userIndices.size);
        if (lastAssistant >= 0) showTimestamps.add(lastAssistant);
        lastUser = i; lastAssistant = -1;
      }
      if (message.role === "assistant") {
        lastAssistant = i;
        if (lastUser >= 0 && messages[lastUser].timestamp !== undefined) responseStarts.set(i, messages[lastUser].timestamp!);
      }
    }
    if (lastAssistant >= 0) showTimestamps.add(lastAssistant);
    return { toolResults, userIndices, lastUser, responseStarts, showTimestamps };
  }, [messages]);
  useImperativeHandle(handleRef, () => ({
    revealEntry(id) {
      const key = entryRows.get(id);
      if (key?.startsWith("compact-process:")) setExpanded((previous) => new Set(previous).add(key));
      const stack = key ? processStacks.get(key) : undefined;
      if (stack) {
        pendingReveal.current = key ?? null;
        setStackChoices(previous => new Map(previous).set(stack.choiceKey, true));
      }
      if (key) list.current?.scrollToKey(key);
    },
    cancelNavigation() { pendingReveal.current = null; list.current?.cancelNavigation(); },
  }), [entryRows, processStacks]);
  const toggle = useCallback((key: string) => setExpanded((previous) => {
    const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next;
  }), []);

  // Mount the newly sent prompt before the session hook's layout scroll runs.
  const pendingUserKey = pendingScrollToUserRef.current ? rows.find((row) => !row.process && row.index === metadata.lastUser)?.key : undefined;
  return <VirtualList keys={keys} pinnedKeys={pendingUserKey ? [pendingUserKey] : []} estimate={160} initialTail scrollContainer={scrollContainer} handleRef={list} renderItem={(_key, rowIndex) => {
    const row = visibleRows[rowIndex];
    if (row.operation) return commandActions ? <ChatCommandCard record={row.operation} actions={commandActions} /> : null;
    if (row.compactProcess) return <CompactProcessSummary group={row.compactProcess}
      onToggle={() => { setInspectCommand(null); toggle(row.key); }}
      onInspectCommand={(id) => { setInspectCommand(id); setExpanded((previous) => new Set(previous).add(row.key)); }} />;
    if (row.process) {
      const { count, toolCalls, expanded: open } = row.process;
      const parts = [t("chat.processDetails"), `${count} ${t(count === 1 ? "chat.message" : "chat.messages")}`];
      if (toolCalls) parts.push(`${toolCalls} ${t(toolCalls === 1 ? "chat.toolCall" : "chat.toolCalls")}`);
      return <div className="chat-process-disclosure"><ChatDisclosureTrigger className="chat-process-toggle" expanded={open} icon="activity"
        label={parts[0]} description={parts.slice(1).join(" · ")} onClick={() => toggle(row.key)}
        title={t(open ? "chat.collapseProcess" : "chat.expandProcess")} /></div>;
    }
    const index = row.index;
    const message = row.message!;
    const stack = processStacks.get(row.key);
    const stackExpanded = !stack || (stackChoices.get(stack.choiceKey) ?? !stack.completed);
    const showTimestamp = row.showTimestamp ?? (metadata.showTimestamps.has(index) && !(streaming && index === messages.length - 1));
    return <CompactProcessContext.Provider value={compactProcess}><RevealProcessCommandContext.Provider value={inspectCommand}><ProcessStackContext.Provider value={stack ? {
      first: row.key === stack.key, expanded: stackExpanded, count: stack.count, timeRanges: stack.timeRanges,
      toggle: () => setStackChoices(previous => new Map(previous).set(stack.choiceKey, !stackExpanded)),
      onInteract: () => setStackChoices(previous => previous.get(stack.choiceKey) === true ? previous : new Map(previous).set(stack.choiceKey, true)),
    } : null}><ProcessCompletedContext.Provider value={completedTurns[index] ?? false}><div className={`chat-message-shell${row.secondary ? " compact-process-detail" : ""}${highlightedEntryId === entryIds[index] ? " is-search-target" : ""}`} data-chat-entry-id={entryIds[index]} data-chat-user-index={metadata.userIndices.get(index)}
      data-process-join-before={stack && stackExpanded && row.key !== stack.key || undefined}
      data-process-join-after={stack && stackExpanded && row.key !== stack.last || undefined}
      ref={index === metadata.lastUser ? (element) => { lastUserMsgRef.current = element; if (element && pendingScrollToUserRef.current) list.current?.cancelNavigation(); } : undefined}>
      <RenderErrorBoundary resetKey={messageFingerprint(message, entryIds[index])} fallbackLabel={t("chat.messageRenderFailed")} errorTitle={t("chat.messageRenderError")}>
        <MessageView {...messageProps} message={message} intermediate={row.intermediate} isStreaming={row.isStreaming} toolResults={metadata.toolResults} entryId={entryIds[index]}
          messageActions={onDeleteMessage && (entryIds[index] || message.role === "user" && message.clientPromptId) ? <DeleteMessageAction message={messages[index]} entryId={entryIds[index]} onDelete={onDeleteMessage} disabled={deleteDisabled || busy || streaming} /> : null}
          onFork={busy || isNew || index === 0 && message.role === "user" ? undefined : messageProps.onFork}
          onNavigate={busy ? undefined : messageProps.onNavigate}
          forking={forkingEntryId === entryIds[index]}
          prevAssistantEntryId={!busy && message.role === "user" && messages[index - 1]?.role === "assistant" ? entryIds[index - 1] : undefined}
          showTimestamp={showTimestamp} prevTimestamp={messages[index - 1]?.timestamp}
          responseStartedAt={showTimestamp && !(busy && index > metadata.lastUser) ? metadata.responseStarts.get(index) : undefined} />
      </RenderErrorBoundary>
    </div></ProcessCompletedContext.Provider></ProcessStackContext.Provider></RevealProcessCommandContext.Provider></CompactProcessContext.Provider>;
  }} />;
});
