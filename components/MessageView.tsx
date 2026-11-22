"use client";

import { memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { CommandExecutionData } from "@/lib/command-execution";
import type { CompletedGoalBadge } from "@/lib/workflow-types";
import { GoalAchievedBadge } from "./workflow/GoalAchievedBadge";
import {
  getAssistantErrorMessage,
  getThinkingBlockDisplay,
  isAssistantAborted,
  isEmptyThinkingBlock,
  shouldSubscribeToThinkingLoad,
  subscribeToThinkingLoad,
  type ThinkingLoadState,
} from "@/lib/message-display";
import { modelTimeoutDisplay } from "@/lib/model-timeout-display";
import { processTimeRange } from "@/lib/process-duration";
import { summarizeProviderError } from "@/lib/provider-payload";
import { formatStatusDuration } from "@/lib/status-duration";
import { isSubagentTool, hasSubagentProjection, projectSubagentDetail, type SubagentDetail } from "@/lib/subagent-types";
import { taskElapsedMs, type TaskTiming } from "@/lib/task-timing";
import { thinkingPreview } from "@/lib/thinking-preview";
import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  BashExecutionMessage,
  CustomMessage,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  ToolResultMessage,
  UserMessage,
} from "@/lib/types";
import { AliIcon } from "./AliIcon";
import { ChatContentContextMenu } from "./ChatContentContextMenu";
import { ChatDisclosure } from "./ChatDisclosure";
import { LazyMarkdownBody as MarkdownBody } from "./LazyMarkdownBody";
import { ProcessStack } from "./ProcessStack";
import { SubagentTaskCard } from "./SubagentTaskCard";
import { SubagentCompletionCard } from "./subagents/SubagentCompletionCard";
import { useVirtualRowToggle } from "./VirtualRowState";
import { BashExecutionView, CompactionMessageView, CustomMessageView } from "./message-view/CustomMessageViews";
import {
  formatTime,
  getMessageText,
  haveSameRelevantToolResults,
  HistoryModeContext,
  HistoryVersionContext,
  loadThinkingContent,
  ToolRunActiveContext,
} from "./message-view/shared";
import { ToolCallBlock } from "./message-view/ToolCallBlock";
import { UserMessageView } from "./message-view/UserMessageView";

export { getAutomationToolCardDetails, getUserMessagePreview } from "./message-view/shared";

const AutomationCard = dynamic(
  () => import("./AutomationPanel").then((module) => module.AutomationCard),
  { ssr: false },
);

interface Props {
  mode?: "chat" | "history";
  historyVersion?: string;
  messageActions?: ReactNode;
  message: AgentMessage;
  isStreaming?: boolean;
  toolRunActive?: boolean;
  intermediate?: boolean;
  toolResults?: Pick<ReadonlyMap<string, ToolResultMessage>, "get">;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => Promise<boolean>;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  onEditFailed?: (message: UserMessage) => Promise<void>;
  onRetry?: (message: UserMessage, entryId?: string) => Promise<void>;
  retryPrompt?: { message: UserMessage; entryId?: string };
  retryDisabled?: boolean;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  taskTiming?: TaskTiming;
  sessionId?: string;
  onOpenAutomation?: (automationId: string) => void;
  onOpenCommandExecution?: (data: CommandExecutionData) => void;
  completedGoal?: CompletedGoalBadge | null;
}

export const MessageView = memo(function MessageView(props: Props) {
  const history = props.mode === "history";
  return (
    <HistoryModeContext.Provider value={history}>
      <ToolRunActiveContext.Provider value={!history && (props.toolRunActive ?? props.isStreaming ?? false)}>
        <HistoryVersionContext.Provider value={props.historyVersion}>
          <ChatContentContextMenu cwd={props.cwd} onOpenFile={props.onOpenFile}>
            <MessageContent
              {...props}
              onFork={history ? undefined : props.onFork}
              onNavigate={history ? undefined : props.onNavigate}
              onEditFailed={history ? undefined : props.onEditFailed}
              onRetry={history ? undefined : props.onRetry}
              onEditContent={history ? undefined : props.onEditContent}
              onOpenAutomation={history ? undefined : props.onOpenAutomation}
            />
          </ChatContentContextMenu>
        </HistoryVersionContext.Provider>
      </ToolRunActiveContext.Provider>
    </HistoryModeContext.Provider>
  );
});

const MessageContent = memo(function MessageContent({
  mode,
  messageActions,
  message,
  isStreaming,
  intermediate,
  toolResults,
  modelNames,
  cwd,
  onOpenFile,
  entryId,
  onFork,
  forking,
  onNavigate,
  prevAssistantEntryId,
  onEditContent,
  onEditFailed,
  onRetry,
  retryPrompt,
  retryDisabled,
  showTimestamp,
  prevTimestamp,
  taskTiming,
  sessionId,
  onOpenAutomation,
  onOpenCommandExecution,
  completedGoal,
}: Props) {
  if (message.role === "user") {
    return (
      <UserMessageView
        messageActions={messageActions}
        message={message as UserMessage}
        cwd={cwd}
        onOpenFile={onOpenFile}
        entryId={entryId}
        onFork={onFork}
        forking={forking}
        onNavigate={onNavigate}
        prevAssistantEntryId={prevAssistantEntryId}
        onEditContent={onEditContent}
        onEditFailed={onEditFailed}
        onRetry={onRetry}
        retryDisabled={retryDisabled}
        sessionId={sessionId}
      />
    );
  }
  if (message.role === "assistant") {
    return (
      <AssistantMessageView
        messageActions={messageActions}
        message={message as AssistantMessage}
        isStreaming={isStreaming}
        intermediate={intermediate}
        toolResults={toolResults}
        modelNames={modelNames}
        cwd={cwd}
        onOpenFile={onOpenFile}
        showTimestamp={showTimestamp}
        prevTimestamp={prevTimestamp}
        taskTiming={taskTiming}
        sessionId={sessionId}
        entryId={entryId}
        onOpenAutomation={onOpenAutomation}
        onOpenCommandExecution={onOpenCommandExecution}
        onRetry={onRetry}
        retryPrompt={retryPrompt}
        retryDisabled={retryDisabled}
        completedGoal={completedGoal}
      />
    );
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    if ((message as CustomMessage).customType === "compaction") {
      return <div className="message-row"><CompactionMessageView message={message as CustomMessage} /><div className="message-hover-actions">{messageActions}</div></div>;
    }
    if (mode !== "history" && (message as CustomMessage).customType === "piora-automation") {
      const details = (message as CustomMessage).details as { automationId?: unknown; name?: unknown; rrule?: unknown } | undefined;
      return typeof details?.automationId === "string" ? (
        <div className="message-row">
          <AutomationCard
            automationId={details.automationId}
            fallbackName={typeof details.name === "string" ? details.name : undefined}
            fallbackRrule={typeof details.rrule === "string" ? details.rrule : undefined}
            onOpen={onOpenAutomation}
          />
          <div className="message-hover-actions">{messageActions}</div>
        </div>
      ) : null;
    }
    if ((message as CustomMessage).customType === "piora-subagent-completion") {
      const custom = message as CustomMessage;
      const rawSubagent = (custom.details as { subagent?: unknown } | undefined)?.subagent;
      if (hasSubagentProjection(rawSubagent)) {
        return (
          <SubagentCompletionCard
            record={projectSubagentDetail(rawSubagent)}
            rawText={getMessageText(custom.content)}
            sessionId={sessionId}
            cwd={cwd}
            onOpenFile={onOpenFile}
            messageActions={messageActions}
          />
        );
      }
    }
    return <CustomMessageView messageActions={messageActions} message={message as CustomMessage} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  if (message.role === "bashExecution") {
    return <BashExecutionView messageActions={messageActions} message={message as BashExecutionMessage} sessionId={sessionId} cwd={cwd} onOpenCommandExecution={onOpenCommandExecution} />;
  }
  return null;
}, (prev, next) => {
  return prev.message === next.message
    && prev.mode === next.mode
    && prev.messageActions === next.messageActions
    && prev.isStreaming === next.isStreaming
    && prev.intermediate === next.intermediate
    && haveSameRelevantToolResults(prev.message, prev.toolResults, next.toolResults)
    && prev.modelNames === next.modelNames
    && prev.taskTiming === next.taskTiming
    && prev.cwd === next.cwd
    && prev.onOpenFile === next.onOpenFile
    && prev.entryId === next.entryId
    && prev.onFork === next.onFork
    && prev.forking === next.forking
    && prev.onNavigate === next.onNavigate
    && prev.prevAssistantEntryId === next.prevAssistantEntryId
    && prev.onEditContent === next.onEditContent
    && prev.onEditFailed === next.onEditFailed
    && prev.onRetry === next.onRetry
    && prev.retryPrompt === next.retryPrompt
    && prev.retryDisabled === next.retryDisabled
    && prev.showTimestamp === next.showTimestamp
    && prev.prevTimestamp === next.prevTimestamp
    && prev.sessionId === next.sessionId
    && prev.onOpenAutomation === next.onOpenAutomation
    && prev.onOpenCommandExecution === next.onOpenCommandExecution
    && prev.completedGoal === next.completedGoal;
});

function AssistantMessageView({
  onRetry,
  retryPrompt,
  retryDisabled,
  messageActions,
  message,
  isStreaming,
  intermediate,
  toolResults,
  cwd,
  onOpenFile,
  showTimestamp,
  prevTimestamp,
  taskTiming,
  sessionId,
  entryId,
  onOpenAutomation,
  onOpenCommandExecution,
  completedGoal,
}: {
  onRetry?: Props["onRetry"];
  retryPrompt?: Props["retryPrompt"];
  retryDisabled?: boolean;
  messageActions?: ReactNode;
  message: AssistantMessage;
  isStreaming?: boolean;
  intermediate?: boolean;
  toolResults?: Pick<ReadonlyMap<string, ToolResultMessage>, "get">;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  taskTiming?: TaskTiming;
  sessionId?: string;
  entryId?: string;
  onOpenAutomation?: (automationId: string) => void;
  onOpenCommandExecution?: (data: CommandExecutionData) => void;
  completedGoal?: CompletedGoalBadge | null;
}) {
  const { t } = useI18n();
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const historyMode = useContext(HistoryModeContext);
  const elapsed = taskTiming?.outcome ? taskElapsedMs(taskTiming, 0) : null;
  const responseDuration = elapsed === null ? null : formatStatusDuration(elapsed);
  const blockItems = (Array.isArray(message.content) ? message.content : [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming }));
  const blocks = blockItems.map(({ block }) => block);
  const blockGroups: { process: boolean; items: typeof blockItems }[] = [];
  for (const item of blockItems) {
    const standaloneTool = item.block.type === "toolCall" && (
      isSubagentTool(item.block.toolName)
      || item.block.toolName === "piora_submit_plan"
      || item.block.toolName === "piora_request_user_input"
    );
    const process = item.block.type === "thinking" || (item.block.type === "toolCall" && !standaloneTool);
    const previous = blockGroups.at(-1);
    if (process && previous?.process) previous.items.push(item);
    else blockGroups.push({ process, items: [item] });
  }
  const hideFooter = intermediate || isStreaming || blocks.some((block) => block.type === "toolCall");
  const providerError = getAssistantErrorMessage(message, { isStreaming });
  const providerErrorDetail = providerError ? summarizeProviderError(providerError) : null;
  const timeout = providerError ? modelTimeoutDisplay(providerError) : null;
  const providerErrorSummary = timeout
    ? t(timeout.key, { seconds: timeout.seconds })
    : providerErrorDetail?.code === "model_output_budget"
      ? t("chat.modelOutputBudgetError")
      : providerErrorDetail?.summary ?? "";
  const stopped = isAssistantAborted(message, { isStreaming });
  const retryInFlight = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const blockItemsRef = useRef(blockItems);
  blockItemsRef.current = blockItems;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  // Tool call durations derived from session file timestamps (accurate for completed messages)
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults || !message.timestamp) return map;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const result = toolResults.get(block.toolCallId);
      if (result?.timestamp && message.timestamp) {
        const secs = Math.round((result.timestamp - message.timestamp) / 1000);
        if (secs > 0) map.set(block.toolCallId, secs);
      }
    }
    return map;
  }, [toolResults, message.content, message.timestamp]);

  const textContent = blocks
    .filter((b): b is TextContent => b?.type === "text")
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .join("\n");

  const copyContent = () => {
    copyText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = new Date().getTime();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
        }
        return next;
      });
      return;
    }
    const tick = () => {
      const items = blockItemsRef.current;
      const now = Date.now();
      items.forEach(({ originalIndex }) => {
        if (!blockStartTimesRef.current.has(originalIndex)) blockStartTimesRef.current.set(originalIndex, now);
      });
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < items.length - 1; i++) {
          const originalIndex = items[i].originalIndex;
          const nextOriginalIndex = items[i + 1].originalIndex;
          if (!next.has(originalIndex) && blockStartTimesRef.current.has(originalIndex)) {
            const start = blockStartTimesRef.current.get(originalIndex)!;
            const nextStart = blockStartTimesRef.current.get(nextOriginalIndex) ?? now;
            next.set(originalIndex, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  if (blocks.length === 0 && !isStreaming && !providerError && !stopped) return null;

  return (
    <div
      className="message-row message-row-assistant"
      data-streaming={isStreaming ? "true" : "false"}
      data-intermediate={hideFooter ? "true" : undefined}
      style={{ marginBottom: hideFooter ? 0 : 16 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="message-assistant-blocks">
        {blockGroups.map((group) => {
          const key = `${entryId ?? "stream"}-${group.items[0].originalIndex}`;
          const content = group.items.map(({ block, originalIndex }) => (
            <BlockView
              key={`${entryId ?? "stream"}-${originalIndex}`}
              block={block}
              toolResults={toolResults}
              isStreaming={isStreaming && (block.type !== "thinking" || originalIndex === blockItems.at(-1)?.originalIndex)}
              streamingDuration={streamingDurations.get(originalIndex) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)}
              toolCallDurations={toolCallDurations}
              cwd={cwd}
              onOpenFile={onOpenFile}
              sessionId={sessionId}
              entryId={entryId}
              blockIndex={originalIndex}
              onOpenAutomation={onOpenAutomation}
              onOpenCommandExecution={onOpenCommandExecution}
            />
          ));
          return group.process ? (
            <ProcessStack
              key={key}
              stateKey={key}
              count={group.items.length}
              timeRanges={[processTimeRange(group.items.map(({ block }) => block), message.timestamp, prevTimestamp, toolResults)]}
            >
              {content}
            </ProcessStack>
          ) : (
            <div key={key} className="message-answer-block">{content}</div>
          );
        })}
      </div>

      {(providerError || stopped) && (
        <div
          role={stopped ? "status" : "alert"}
          style={{
            marginTop: blocks.length > 0 ? 8 : 0,
            padding: "7px 10px",
            border: stopped ? "1px solid var(--border)" : "1px solid rgba(239,68,68,0.3)",
            borderRadius: "var(--radius-control)",
            background: stopped ? "var(--bg-panel)" : "rgba(239,68,68,0.07)",
            color: stopped ? "var(--text-muted)" : "#ef4444",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {stopped ? t("chat.generationStopped") : t("chat.providerError", { reason: providerErrorSummary })}
          {!stopped && (providerErrorDetail?.structured || timeout) && (
            <details>
              <summary>{t("chat.providerErrorDetails")}{providerErrorDetail?.code ? ` · ${providerErrorDetail.code}` : ""}</summary>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "8px 0 0" }}>{providerError}</pre>
            </details>
          )}
          {!stopped && onRetry && retryPrompt && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="message-delete-button"
                disabled={retryDisabled || retrying}
                title={t("chat.retryMessageTitle")}
                onClick={() => {
                  if (retryDisabled || retryInFlight.current) return;
                  retryInFlight.current = true;
                  setRetrying(true);
                  setRetryError(null);
                  void onRetry(retryPrompt.message, retryPrompt.entryId)
                    .catch(reason => setRetryError(reason instanceof Error ? reason.message : String(reason)))
                    .finally(() => { retryInFlight.current = false; setRetrying(false); });
                }}
              >
                <AliIcon name="reload" size={12} />{t("chat.retryMessage")}
              </button>
              {retryError && <span role="alert">{retryError}</span>}
            </div>
          )}
        </div>
      )}

      {!hideFooter && (
        <div className="message-response-meta" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          {responseDuration && !isStreaming && (
            <span data-response-task-duration title={t("chat.taskDuration.hint")} style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
              {t("chat.taskDuration.total")} {responseDuration}
            </span>
          )}
          {completedGoal && !isStreaming && <GoalAchievedBadge completedGoal={completedGoal} />}
          {textContent && !isStreaming && !historyMode && (
            <button
              onClick={copyContent}
              title={t("i18n.copyMessage")}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 8px", height: 22,
                background: "none", border: "none",
                borderRadius: "var(--radius-control)",
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: "var(--text-xs)", fontWeight: 400,
                whiteSpace: "nowrap",
                opacity: hovered ? 1 : 0,
                pointerEvents: hovered ? "auto" : "none",
                transition: "opacity 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              {copied ? <AliIcon name="check" size={11} /> : <AliIcon name="copy" size={11} />}
              {copied ? t("i18n.copied") : t("i18n.copy")}
            </button>
          )}
          {!isStreaming ? <span className="message-hover-actions" style={{ marginLeft: "auto" }}>{messageActions}</span> : null}
          {time && !isStreaming && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>{time}</span>
          )}
        </div>
      )}
    </div>
  );
}

function BlockView({
  block,
  toolResults,
  isStreaming,
  streamingDuration,
  toolCallDurations,
  cwd,
  onOpenFile,
  sessionId,
  entryId,
  blockIndex,
  onOpenAutomation,
  onOpenCommandExecution,
}: {
  block: AssistantContentBlock;
  toolResults?: Pick<ReadonlyMap<string, ToolResultMessage>, "get">;
  isStreaming?: boolean;
  streamingDuration?: number;
  toolCallDurations?: Map<string, number>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
  onOpenAutomation?: (automationId: string) => void;
  onOpenCommandExecution?: (data: CommandExecutionData) => void;
}) {
  if (block.type === "text") {
    return <TextBlock block={block as TextContent} isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  if (block.type === "thinking") {
    const thinkingBlock = block as ThinkingContent;
    return (
      <ThinkingBlock
        block={thinkingBlock}
        duration={streamingDuration}
        isStreaming={isStreaming}
        cwd={cwd}
        onOpenFile={onOpenFile}
        sessionId={sessionId}
        entryId={entryId}
        blockIndex={thinkingBlock.deferredBlockIndex ?? blockIndex}
      />
    );
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    if (isSubagentTool(tc.toolName)) {
      return (
        <SubagentTaskCard
          sessionId={sessionId}
          toolCallId={tc.toolCallId}
          toolName={tc.toolName}
          input={tc.input}
          seed={(result?.details as { subagent?: SubagentDetail } | undefined)?.subagent}
          toolResult={result}
          cwd={cwd}
          onOpenFile={onOpenFile}
        />
      );
    }
    return (
      <ToolCallBlock
        block={tc}
        preparing={isStreaming}
        result={result}
        duration={duration}
        cwd={cwd}
        sessionId={sessionId}
        onOpenFile={onOpenFile}
        onOpenAutomation={onOpenAutomation}
        onOpenCommandExecution={onOpenCommandExecution}
      />
    );
  }
  return null;
}

function TextBlock({ block, isStreaming, cwd, onOpenFile }: { block: TextContent; isStreaming?: boolean; cwd?: string; onOpenFile?: (filePath: string) => void }) {
  return <MarkdownBody className="markdown-assistant-message" isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile}>{block.text}</MarkdownBody>;
}

function ThinkingBlock({
  block,
  duration,
  isStreaming,
  cwd,
  onOpenFile,
  sessionId,
  entryId,
  blockIndex,
}: {
  block: ThinkingContent;
  duration?: number;
  isStreaming?: boolean;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useVirtualRowToggle(`thinking:${blockIndex}`, Boolean(isStreaming));
  const wasThinking = useRef(Boolean(isStreaming));
  useEffect(() => {
    const thinking = Boolean(isStreaming);
    if (wasThinking.current !== thinking) {
      wasThinking.current = thinking;
      setExpanded(thinking);
    }
  }, [isStreaming, setExpanded]);
  const historyVersion = useContext(HistoryVersionContext);
  const [loadState, setLoadState] = useState<ThinkingLoadState | null>(null);
  const sourceKey = sessionId && entryId ? `${sessionId}:${entryId}:${blockIndex}:${historyVersion ?? "chat"}` : null;
  const loadStateRef = useRef(loadState);
  const currentSourceKeyRef = useRef(sourceKey);
  loadStateRef.current = loadState;
  currentSourceKeyRef.current = sourceKey;

  useEffect(() => {
    if (!expanded || !block.deferred || !sourceKey || !sessionId || !entryId) return;
    const existing = loadStateRef.current;
    if (!shouldSubscribeToThinkingLoad(sourceKey, existing)) return;

    return subscribeToThinkingLoad(
      sourceKey,
      loadThinkingContent(sessionId, entryId, blockIndex, historyVersion),
      () => currentSourceKeyRef.current === sourceKey,
      setLoadState,
    );
  }, [block.deferred, blockIndex, entryId, expanded, sessionId, sourceKey, historyVersion]);

  const display = block.deferred && !sourceKey
    ? { status: "error" as const, error: t("i18n.thinkingUnavailable") }
    : getThinkingBlockDisplay(block, sourceKey, loadState);

  return (
    <ChatDisclosure
      className="thinking-block"
      triggerClassName="thinking-block-trigger"
      expanded={expanded}
      onExpandedChange={setExpanded}
      icon="brain"
      label={t("i18n.thinking")}
      description={!expanded && display.status === "content" ? thinkingPreview(display.content, isStreaming) : undefined}
      metadata={duration !== undefined ? `${duration}s` : undefined}
    >
      <div className={`thinking-block-content${display.status === "error" ? " is-error" : ""}`}>
        {display.status === "loading"
          ? <span className="thinking-block-status">{t("i18n.loadingThinking")}</span>
          : display.status === "error"
            ? <span className="thinking-block-status">{display.error}</span>
            : display.status === "content"
              ? <MarkdownBody className="markdown-thinking" isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile}>{display.content}</MarkdownBody>
              : null}
      </div>
    </ChatDisclosure>
  );
}
