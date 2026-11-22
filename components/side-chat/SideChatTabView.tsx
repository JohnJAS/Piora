"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useI18n } from "@/hooks/useI18n";
import { responseTaskTimings } from "@/lib/response-task-timing";
import { formatQuotedSideSelection } from "@/lib/side-chat/composer-trigger";
import type { SideChatSummary } from "@/lib/side-chat/types";
import type { TaskRuntimeSnapshot } from "@/lib/task-status";
import type { AgentMessage, BashExecutionMessage, SessionInfo } from "@/lib/types";
import { AliIcon } from "../AliIcon";
import { BrowserHandoffNotice } from "../BrowserHandoffNotice";
import { ChatCommandQueue, type ChatCommandCardActions, type ChatCommandQueueActions } from "../ChatCommandCard";
import { ChatHistory, type ChatHistoryHandle } from "../ChatHistory";
import { ChatInput, type ChatInputHandle } from "../ChatInput";
import { CompactProcessContext } from "../CompactProcessContext";
import { ExtensionCustomPanel, ExtensionDialog } from "../ExtensionUi";
import { MessageView } from "../MessageView";
import { NestedToolCallsContext } from "../NestedToolCalls";
import { ToolReviewStatus } from "../ToolReviewStatus";
import { InlineUserInputCard } from "../workflow/InlineUserInputCard";
import {
  deriveParentStatus,
  dispatchInsertIntoMainComposer,
  PIORA_SIDE_CHAT_FOCUS_COMPOSER_EVENT,
} from "./side-chat-events";
import type {
  PendingSideChatCreate,
  SideChatLaunchPayload,
  SideChatLiveActivity,
} from "./useSideChatController";
import styles from "./SideChat.module.css";

export interface SideChatTabViewProps {
  sideChat?: SideChatSummary;
  loadingEntry?: PendingSideChatCreate;
  active: boolean;
  parentSnapshot?: TaskRuntimeSnapshot | null;
  parentRunning?: boolean;
  launchPayload?: SideChatLaunchPayload;
  onConsumeLaunch?: (sideId: string) => void;
  onJumpToParent: () => void;
  onRestartExpired: (sideId: string) => void;
  onOpenFile?: (filePath: string) => void;
  onAgentEnd: (sideId: string) => void;
  onActivityChange?: (sideId: string, activity: SideChatLiveActivity) => void;
}

function ParentStatusStrip({
  parentSnapshot,
  parentRunning,
  isTemporary,
  onJumpToParent,
}: {
  parentSnapshot?: TaskRuntimeSnapshot | null;
  parentRunning?: boolean;
  isTemporary?: boolean;
  onJumpToParent: () => void;
}) {
  const { t } = useI18n();
  const status = deriveParentStatus(parentSnapshot, parentRunning);
  return (
    <div className={styles.parentStatusStrip}>
      <div className={styles.parentStatusMeta}>
        <span className={styles.parentStatusPill} data-status={status}>
          <span className={styles.statusDot} data-status={status} aria-hidden="true" />
          <span>{t(`sideChat.parentStatus.${status}`)}</span>
        </span>
        {isTemporary ? <span className={styles.tempBadge}>{t("sideChat.tempBadge")}</span> : null}
      </div>
      <button type="button" className={styles.jumpParentButton} onClick={onJumpToParent}>
        <AliIcon name="arrowleft" size={12} />
        <span>{t("sideChat.jumpToParent")}</span>
      </button>
    </div>
  );
}

function SideChatExpiredState({ onRestart }: { onRestart: () => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.expiredState} data-testid="side-chat-expired-state">
      <div className={styles.stateIcon} aria-hidden="true">
        <AliIcon name="timer" size={18} />
      </div>
      <h3 className={styles.stateTitle}>{t("sideChat.expiredTitle")}</h3>
      <p className={styles.stateDescription}>{t("sideChat.expiredDescription")}</p>
      <button type="button" className={styles.primaryButton} onClick={onRestart}>
        <AliIcon name="plus" size={13} />
        <span>{t("sideChat.startNew")}</span>
      </button>
    </div>
  );
}

function SideChatEmptyState() {
  const { t } = useI18n();
  return (
    <div className={styles.emptyState}>
      <div className={styles.stateIcon} aria-hidden="true">
        <AliIcon name="chat-bubble-plus" size={18} />
      </div>
      <h3 className={styles.stateTitle}>{t("sideChat.emptyTitle")}</h3>
      <p className={styles.stateDescription}>{t("sideChat.emptyDescription")}</p>
    </div>
  );
}

function LiveSideChatSessionView({
  sideChat,
  active,
  parentSnapshot,
  parentRunning,
  launchPayload,
  onConsumeLaunch,
  onJumpToParent,
  onRestartExpired,
  onOpenFile,
  onAgentEnd,
  onActivityChange,
}: {
  sideChat: SideChatSummary;
  active: boolean;
  parentSnapshot?: TaskRuntimeSnapshot | null;
  parentRunning?: boolean;
  launchPayload?: SideChatLaunchPayload;
  onConsumeLaunch?: (sideId: string) => void;
  onJumpToParent: () => void;
  onRestartExpired: (sideId: string) => void;
  onOpenFile?: (filePath: string) => void;
  onAgentEnd: (sideId: string) => void;
  onActivityChange?: (sideId: string, activity: SideChatLiveActivity) => void;
}) {
  const { t } = useI18n();
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const historyRef = useRef<ChatHistoryHandle | null>(null);
  const consumedLaunchRef = useRef(false);
  const [browserWaiting, setBrowserWaiting] = useState(false);

  const syntheticSession = useMemo<SessionInfo>(() => ({
    id: sideChat.id,
    path: "",
    cwd: sideChat.cwd,
    name: sideChat.isDefaultTitle ? undefined : sideChat.title,
    created: sideChat.createdAt,
    modified: sideChat.modifiedAt,
    messageCount: sideChat.messageCount,
    firstMessage: sideChat.preview,
  }), [
    sideChat.createdAt,
    sideChat.cwd,
    sideChat.id,
    sideChat.isDefaultTitle,
    sideChat.messageCount,
    sideChat.modifiedAt,
    sideChat.preview,
    sideChat.title,
  ]);

  const {
    nestedCallsStore,
    loading,
    sessionHydrating,
    error,
    retrySessionLoad,
    messages,
    entryIds,
    modelChanges,
    streamState,
    toolPermission,
    permissionSaving,
    handleToolPermission,
    toolReviews,
    agentRunning,
    bashRunning,
    pendingBash,
    modelNames,
    modelList,
    modelError,
    modelThinkingLevels,
    modelThinkingLevelMaps,
    thinkingLevel,
    retryInfo,
    contextUsage,
    displayModel,
    sessionStats,
    slashCommands,
    slashCommandsLoading,
    slashCommandsError,
    commandCatalog,
    chatCommands,
    queuedMessages,
    notices,
    extensionDialog,
    extensionCustomUi,
    extensionStatuses,
    respondToExtensionUi,
    sendExtensionCustomInput,
    isAutoModelSelection,
    agentPhase,
    interruptedRunId,
    isCompacting,
    compactionStartedAt,
    compactError,
    compactResult,
    messagesEndRef,
    scrollContainerRef,
    lastUserMsgRef,
    pendingScrollToUserRef,
    handleSend,
    handleAbort,
    handleModelChange,
    handleCompact,
    handleDismissCompactError,
    handleDismissCompactResult,
    handleSteer,
    handleFollowUp,
    handlePromptWithStreamingBehavior,
    handleAbortCompaction,
    handlePendingInputAction,
    handleThinkingLevelChange,
    loadSlashCommands,
  } = useAgentSession({
    viewVisible: active,
    workflowEnabled: false,
    workflowReady: true,
    session: syntheticSession,
    initialRunning: sideChat.running,
    newSessionCwd: sideChat.cwd,
    chatInputRef,
    onAgentEnd,
  });

  const sessionBusy = agentRunning || bashRunning;
  const sessionReadOnly = loading || sessionHydrating || Boolean(error);
  const isExpired = sideChat.expired || Boolean(error && /expired/i.test(error));
  const hasLiveMessages = messages.length > 0 || streamState.isStreaming || chatCommands.records.length > 0;
  const isLiveRunning = sessionBusy || streamState.isStreaming;

  useEffect(() => {
    onActivityChange?.(sideChat.id, { hasMessages: hasLiveMessages, isRunning: isLiveRunning });
  }, [hasLiveMessages, isLiveRunning, onActivityChange, sideChat.id]);

  const availableThinkingLevels = displayModel
    ? (modelThinkingLevels[`${displayModel.provider}:${displayModel.modelId}`] ?? null)
    : null;
  const currentThinkingLevelMap = displayModel
    ? (modelThinkingLevelMaps[`${displayModel.provider}:${displayModel.modelId}`] ?? null)
    : null;

  const responseTimings = useMemo(
    () => responseTaskTimings(messages, chatCommands.taskTimings),
    [chatCommands.taskTimings, messages],
  );

  // Deliver initial `/side <question>` or floating-selection quote once when session settles.
  useEffect(() => {
    if (consumedLaunchRef.current || !launchPayload || loading || sessionHydrating || error) return;
    if (launchPayload.submittedCommandId) {
      if (agentRunning || messages.length > 0) {
        consumedLaunchRef.current = true;
        onConsumeLaunch?.(sideChat.id);
        return;
      }
      const controller = new AbortController();
      let attempts = 0;
      const poll = async () => {
        while (!controller.signal.aborted && attempts < 20) {
          attempts += 1;
          try {
            const res = await fetch(
              `/api/agent/${encodeURIComponent(sideChat.id)}?view=progress&promptCommandId=${encodeURIComponent(launchPayload.submittedCommandId!)}`,
              { cache: "no-store", signal: controller.signal },
            );
            if (res.ok) {
              const payload = await res.json() as { running?: boolean; promptCommand?: { status?: string } | null };
              const status = payload.promptCommand?.status;
              const settled = status && ["completed", "failed", "cancelled", "expired", "interrupted"].includes(status);
              if (payload.running || settled) {
                consumedLaunchRef.current = true;
                onConsumeLaunch?.(sideChat.id);
                retrySessionLoad();
                return;
              }
            }
          } catch {
            if (controller.signal.aborted) return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!controller.signal.aborted) {
          consumedLaunchRef.current = true;
          onConsumeLaunch?.(sideChat.id);
        }
      };
      void poll();
      return () => controller.abort();
    }
    consumedLaunchRef.current = true;
    const { initialPrompt, quotedSelection } = launchPayload;
    onConsumeLaunch?.(sideChat.id);
    if (initialPrompt?.trim()) {
      void handleSend(initialPrompt.trim());
    } else if (quotedSelection?.trim()) {
      chatInputRef.current?.insertQuotedText(formatQuotedSideSelection(quotedSelection));
    }
  }, [agentRunning, error, handleSend, launchPayload, loading, messages.length, onConsumeLaunch, retrySessionLoad, sessionHydrating, sideChat.id]);

  // Focus side chat composer when requested from palette/shortcut/tab activation.
  useEffect(() => {
    if (!active) return;
    const onFocusRequest = (event: Event) => {
      const targetId = (event as CustomEvent<{ sideId?: string }>).detail?.sideId;
      if (targetId && targetId !== sideChat.id) return;
      requestAnimationFrame(() => chatInputRef.current?.focus());
    };
    window.addEventListener(PIORA_SIDE_CHAT_FOCUS_COMPOSER_EVENT, onFocusRequest);
    return () => window.removeEventListener(PIORA_SIDE_CHAT_FOCUS_COMPOSER_EVENT, onFocusRequest);
  }, [active, sideChat.id]);

  const handleEditContent = useCallback((content: string) => {
    chatInputRef.current?.insertIfEmpty(content);
  }, []);

  const commandActions = useMemo<ChatCommandCardActions>(() => ({
    retry: async (record) => {
      const draft = await chatCommands.restore(record);
      const accepted = await handleSend(
        draft.value,
        draft.images.map((image) => ({ ...image, previewUrl: "" })),
        draft.files,
        undefined,
        [...new Set([...(draft.retryOfPromptIds ?? []), record.idempotencyKey])],
        draft.commandInput,
      );
      if (accepted === false) throw new Error(t("chatCommands.restoreFailed"));
    },
    restore: async (record, queryOnly) => {
      const draft = await chatCommands.restore(record);
      const restored = {
        ...draft,
        value: queryOnly ? record.operation?.afterPrompt ?? draft.value : draft.value,
        ...(queryOnly ? { commandInput: { inputMode: "text" as const } } : {}),
        retryOfPromptIds: [...new Set([...(draft.retryOfPromptIds ?? []), record.idempotencyKey])],
      };
      if (!chatInputRef.current?.restoreCommandDraft(restored)) throw new Error(t("chatCommands.composerBusy"));
      chatInputRef.current.focus();
    },
    cancel: chatCommands.cancel,
    copy: chatCommands.copy,
  }), [chatCommands, handleSend, t]);

  const { queueAction, edit: editQueuedDraft } = chatCommands;
  const queueActions = useMemo<ChatCommandQueueActions>(() => ({
    cancel: async (record) => { await queueAction(record, "cancel"); },
    steer: async (record) => { await queueAction(record, "steer"); },
    edit: editQueuedDraft,
    save: async (record, text) => { await queueAction(record, "edit", text); },
    resume: async (record) => { await queueAction(record, "resume"); },
  }), [editQueuedDraft, queueAction]);

  if (isExpired) {
    return (
      <div className={styles.sideChatTabRoot}>
        <ParentStatusStrip
          parentSnapshot={parentSnapshot}
          parentRunning={parentRunning}
          isTemporary={sideChat.storage === "temporary"}
          onJumpToParent={onJumpToParent}
        />
        <SideChatExpiredState onRestart={() => onRestartExpired(sideChat.id)} />
      </div>
    );
  }

  return (
    <div className={styles.sideChatTabRoot} data-side-chat-id={sideChat.id}>
      <ParentStatusStrip
        parentSnapshot={parentSnapshot}
        parentRunning={parentRunning}
        isTemporary={sideChat.storage === "temporary"}
        onJumpToParent={onJumpToParent}
      />

      <BrowserHandoffNotice sessionId={sideChat.id} busy={sessionBusy} onWaitingChange={setBrowserWaiting} />
      {extensionDialog && extensionDialog.method !== "request_user_input" ? (
        <ExtensionDialog request={extensionDialog} onRespond={respondToExtensionUi} />
      ) : null}
      {extensionCustomUi ? (
        <ExtensionCustomPanel request={extensionCustomUi} onInput={sendExtensionCustomInput} />
      ) : null}

      <div ref={scrollContainerRef} className={styles.transcriptScroll}>
        {error ? (
          <div className="session-history-status">
            <div role="alert">
              <div>{t("chat.sessionSwitchFailed")}</div>
              <div className="text-text-muted">{error}</div>
            </div>
            <button type="button" onClick={retrySessionLoad}>{t("common.retry")}</button>
          </div>
        ) : null}

        {loading && messages.length === 0 ? (
          <div className="session-history-status" role="status">{t("chat.loadingSession")}</div>
        ) : null}

        {!loading && !error && messages.length === 0 && !streamState.isStreaming && !sessionBusy ? (
          <SideChatEmptyState />
        ) : null}

        {messages.length > 0 || streamState.isStreaming ? (
          <NestedToolCallsContext.Provider value={nestedCallsStore}>
            <ChatHistory
              visible={active}
              key={sideChat.id}
              operations={chatCommands.records}
              commandActions={commandActions}
              responseTimings={responseTimings}
              modelChanges={modelChanges}
              messages={messages}
              compactProcess
              interruptionId={interruptedRunId}
              streamingMessage={streamState.isStreaming ? (streamState.streamingMessage as AgentMessage) : null}
              entryIds={entryIds}
              busy={sessionBusy}
              streaming={streamState.isStreaming}
              isNew={false}
              forkingEntryId={null}
              highlightedEntryId={null}
              lastUserMsgRef={lastUserMsgRef}
              pendingScrollToUserRef={pendingScrollToUserRef}
              scrollContainer={scrollContainerRef}
              handleRef={historyRef}
              modelNames={modelNames}
              cwd={sideChat.cwd}
              onOpenFile={onOpenFile}
              onEditContent={handleEditContent}
              onInsertIntoMain={dispatchInsertIntoMainComposer}
              sessionId={sideChat.id}
            />
          </NestedToolCallsContext.Provider>
        ) : null}

        {sessionBusy ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 4px", fontSize: "var(--text-xs)", color: "var(--text-muted)" }} role="status">
            <span className={styles.statusDot} data-status="running" aria-hidden="true" />
            <span>{browserWaiting ? t("chat.browserWaiting") : agentPhase?.kind === "stopping" ? t("chat.stopping") : t("sideChat.runningIndicator")}</span>
          </div>
        ) : null}

        {pendingBash ? (
          <CompactProcessContext.Provider value={true}>
            <MessageView
              message={{
                role: "bashExecution",
                command: pendingBash.command,
                output: pendingBash.output ?? "",
                excludeFromContext: pendingBash.excludeFromContext,
              } as BashExecutionMessage}
              sessionId={sideChat.id}
              cwd={sideChat.cwd}
            />
          </CompactProcessContext.Provider>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {notices.length > 0 ? (
        <div className={styles.inlineUiDock}>
          {notices.map((notice) => (
            <div key={notice.id} role="status" style={{ fontSize: "var(--text-xs)", color: notice.type === "error" ? "#dc2626" : "var(--text-muted)", padding: "4px 6px" }}>
              {notice.message}
            </div>
          ))}
        </div>
      ) : null}

      {extensionDialog?.method === "request_user_input" ? (
        <div className={styles.inlineUiDock}>
          <InlineUserInputCard
            key={extensionDialog.id}
            request={extensionDialog}
            sessionId={sideChat.id}
            onRespond={respondToExtensionUi}
          />
        </div>
      ) : null}

      <div className={styles.composerDock}>
        <ToolReviewStatus reviews={toolReviews} />
        <ChatCommandQueue
          records={chatCommands.records}
          actions={queueActions}
          pendingMessages={queuedMessages}
          onPendingAction={handlePendingInputAction}
        />
        <ChatInput
          ref={chatInputRef}
          surfacePlacement="side"
          workflowEnabled={false}
          sendDisabled={sessionReadOnly}
          placeholder={t("sideChat.composerPlaceholder")}
          onSend={handleSend}
          onQueueInput={chatCommands.submit}
          commandCatalog={commandCatalog}
          slashCommandsError={slashCommandsError}
          onAbort={handleAbort}
          onSteer={agentRunning ? handleSteer : undefined}
          onFollowUp={agentRunning ? handleFollowUp : undefined}
          onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
          isStreaming={sessionBusy}
          model={displayModel}
          isAutoModelSelection={isAutoModelSelection}
          modelNames={modelNames}
          modelList={modelList}
          modelError={modelError}
          onModelChange={sessionReadOnly ? undefined : handleModelChange}
          onCompact={sessionReadOnly ? undefined : handleCompact}
          onAbortCompaction={handleAbortCompaction}
          isCompacting={isCompacting}
          compactionStartedAt={compactionStartedAt}
          compactError={compactError}
          onDismissCompactError={handleDismissCompactError}
          compactResult={compactResult}
          onDismissCompactResult={handleDismissCompactResult}
          thinkingLevel={thinkingLevel}
          toolPermission={toolPermission}
          permissionSaving={permissionSaving}
          onToolPermissionChange={sessionReadOnly ? undefined : handleToolPermission}
          onThinkingLevelChange={sessionReadOnly ? undefined : handleThinkingLevelChange}
          availableThinkingLevels={availableThinkingLevels}
          thinkingLevelMap={currentThinkingLevelMap}
          retryInfo={retryInfo}
          slashCommands={slashCommands}
          slashCommandsLoading={slashCommandsLoading}
          onLoadSlashCommands={loadSlashCommands}
          draftKey={`sidechat:${sideChat.id}`}
          cwd={sideChat.cwd}
          contextUsage={contextUsage}
          sessionStats={sessionStats}
          extensionStatuses={extensionStatuses}
        />
      </div>
    </div>
  );
}

/** Side conversation surface hosted inside the RightPanel tab strip. */
export function SideChatTabView(props: SideChatTabViewProps) {
  const { t } = useI18n();
  if (props.loadingEntry && !props.sideChat) {
    return (
      <div className={styles.sideChatTabRoot}>
        <ParentStatusStrip
          parentSnapshot={props.parentSnapshot}
          parentRunning={props.parentRunning}
          isTemporary={props.loadingEntry.storage === "temporary"}
          onJumpToParent={props.onJumpToParent}
        />
        <div className={styles.loadingState} role="status">
          <div className={styles.stateIcon} aria-hidden="true">
            <AliIcon name="chat-bubble-plus" size={18} />
          </div>
          <p className={styles.stateDescription}>{t("sideChat.creating")}</p>
        </div>
      </div>
    );
  }

  if (!props.sideChat) return null;

  return <LiveSideChatSessionView key={props.sideChat.id} {...props} sideChat={props.sideChat} />;
}
