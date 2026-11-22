"use client";

import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { messageImageUrl } from "@/lib/message-images";
import type { ImageContent, TextContent, UserMessage } from "@/lib/types";
import { isEditedPlanImplementationMessage, isPlanImplementationMessage } from "@/lib/workflow/plan-prompt";
import { AliIcon } from "../AliIcon";
import { DisclosureChevron } from "../ChatDisclosure";
import { MessageImage, MessageImageViewer } from "../MessageImage";
import { UserMessageText } from "../UserMessageText";
import { useVirtualRowToggle } from "../VirtualRowState";
import {
  formatTime,
  getUserMessagePreview,
  HistoryModeContext,
  HistoryVersionContext,
  imageSource,
} from "./shared";

export function UserMessageView({
  messageActions,
  message,
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
  retryDisabled,
  sessionId,
}: {
  messageActions?: ReactNode;
  message: UserMessage;
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
  retryDisabled?: boolean;
  sessionId?: string;
}) {
  const { t, locale } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [contentExpanded, setContentExpanded] = useVirtualRowToggle("user-content");
  const [loadedContent, setLoadedContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentLoadError, setContentLoadError] = useState<string | null>(null);
  const [openImageIndex, setOpenImageIndex] = useState<number | null>(null);

  const initialContent =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content
          .filter((b): b is TextContent => b?.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("\n")
        : "";
  const content = loadedContent ?? initialContent;
  const historyVersion = useContext(HistoryVersionContext);
  const historyMode = useContext(HistoryModeContext);
  const hasDeferredContent = message.deferredContent === true && loadedContent === null;

  const imageBlocks: ImageContent[] =
    Array.isArray(message.content)
      ? message.content.filter((b): b is ImageContent => b?.type === "image")
      : [];

  const time = formatTime(message.timestamp);
  const sendError = message.sendError;
  const canFork = !!entryId && !!onFork;
  const canNavigate = !!entryId && !!prevAssistantEntryId && !!onNavigate;
  const isPlanImplementation = !hasDeferredContent && isPlanImplementationMessage(content);
  const contentPreview = useMemo(() => {
    if (isPlanImplementation) {
      return { preview: content, collapsible: false, lineCount: 1 };
    }
    const preview = getUserMessagePreview(content);
    return hasDeferredContent
      ? { ...preview, collapsible: true, lineCount: message.deferredLineCount ?? preview.lineCount }
      : preview;
  }, [content, hasDeferredContent, isPlanImplementation, message.deferredLineCount]);
  const displayedContent = isPlanImplementation
    ? t(isEditedPlanImplementationMessage(content) ? "workflow.plan.implementEditedYes" : "workflow.plan.implementYes")
    : contentPreview.collapsible && !contentExpanded
      ? contentPreview.preview
      : content;
  const contentLineCount = contentPreview.lineCount.toLocaleString(locale);

  const loadFullContent = useCallback(async (): Promise<string> => {
    if (!hasDeferredContent) return content;
    if (!sessionId || !entryId) throw new Error(t("chat.longMessageUnavailable"));
    setContentLoading(true);
    setContentLoadError(null);
    try {
      const response = await fetch(
        historyVersion
          ? `/api/sessions/${encodeURIComponent(sessionId)}/history/content?${new URLSearchParams({ entryId, kind: "prompt", version: historyVersion })}`
          : `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/prompt-material`,
        historyVersion ? { signal: AbortSignal.timeout(30_000) } : undefined,
      );
      const body = await response.json().catch(() => ({})) as { content?: unknown; error?: unknown };
      if (!response.ok || typeof body.content !== "string") {
        throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
      }
      setLoadedContent(body.content);
      return body.content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setContentLoadError(errorMessage);
      throw error;
    } finally {
      setContentLoading(false);
    }
  }, [hasDeferredContent, content, sessionId, entryId, t, historyVersion]);

  useEffect(() => {
    if (contentExpanded && hasDeferredContent) void loadFullContent().catch(() => {});
  }, [contentExpanded, hasDeferredContent, loadFullContent]);

  const copyContent = () => {
    Promise.resolve(loadFullContent()).then((fullContent) => copyText(fullContent)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const toggleContent = () => {
    if (contentExpanded) {
      setContentExpanded(false);
      return;
    }
    if (!hasDeferredContent) {
      setContentExpanded(true);
      return;
    }
    void loadFullContent().then(() => setContentExpanded(true)).catch(() => {});
  };

  return (
    <div
      className="message-row message-row-user"
      style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: "flex-end" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, maxWidth: "85%" }}>
        <div
          className="message-user-bubble"
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--user-bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-surface)",
            padding: "8px 12px",
            fontSize: "var(--text-base)",
            lineHeight: 1.6,
            color: "var(--text)",
            wordBreak: "break-word",
          }}
        >
          {imageBlocks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
              {imageBlocks.map((img, i) => {
                const src = messageImageUrl(img);
                return src ? <MessageImage key={i} src={src} index={i} onOpen={() => setOpenImageIndex(i)} /> : null;
              })}
            </div>
          )}
          {openImageIndex !== null && imageBlocks[openImageIndex] && (
            <MessageImageViewer
              src={imageSource(imageBlocks[openImageIndex])}
              index={openImageIndex}
              onClose={() => setOpenImageIndex(null)}
            />
          )}
          {content && (
            <>
              <UserMessageText text={displayedContent} cwd={cwd} onOpenFile={onOpenFile} />
              {contentPreview.collapsible && (
                <button
                  type="button"
                  className="message-user-expand"
                  aria-expanded={contentExpanded}
                  aria-label={t(contentExpanded ? "chat.collapseLongMessage" : "chat.expandLongMessage", { count: contentLineCount })}
                  onClick={toggleContent}
                  disabled={contentLoading}
                >
                  <DisclosureChevron />
                  {contentLoading
                    ? t("chat.loadingLongMessage")
                    : t(contentExpanded ? "chat.collapseLongMessage" : "chat.expandLongMessage", { count: contentLineCount })}
                </button>
              )}
              {contentLoadError && <div role="alert" style={{ marginTop: 6, color: "var(--status-failed)", fontSize: "var(--text-xs)" }}>{contentLoadError}</div>}
            </>
          )}
        </div>
      </div>

      {sendError && (
        <div role="alert" style={{ marginTop: -10, marginBottom: 10, color: "var(--status-failed, #dc2626)", fontSize: "var(--text-xs)", maxWidth: "85%" }}>
          {t(message.sendUnconfirmed ? "chat.sendUnconfirmed" : "chat.sendFailed")}：{sendError}
        </div>
      )}

      {/* Bottom row: action buttons + timestamp */}
      {retryError ? <div role="alert" style={{ color: "var(--status-failed)", fontSize: "var(--text-xs)" }}>{retryError}</div> : null}
      {!historyMode && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 6, marginTop: 3,
        }}>
          {onRetry ? (
            <button
              type="button"
              title={t("chat.retryMessageTitle")}
              disabled={retryDisabled || retrying}
              onClick={() => {
                if (retrying || retryDisabled) return;
                setRetrying(true);
                setRetryError(null);
                void onRetry(message, entryId)
                  .catch((reason) => setRetryError(reason instanceof Error ? reason.message : String(reason)))
                  .finally(() => setRetrying(false));
              }}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", height: 22,
                background: "none", border: "none", borderRadius: "var(--radius-control)",
                color: "var(--text-dim)", cursor: retryDisabled || retrying ? "not-allowed" : "pointer",
                opacity: hovered ? (retryDisabled ? 0.45 : 1) : 0,
                pointerEvents: hovered ? "auto" : "none",
                transition: "opacity 0.12s", fontSize: "var(--text-xs)",
              }}
            >
              <AliIcon name="reload" size={11} />{t(retrying ? "chat.retryMessageSending" : "chat.retryMessage")}
            </button>
          ) : null}
          <div style={{
            display: "flex", gap: 3,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 0.12s",
          }}>
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
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              {copied ? <AliIcon name="check" size={11} /> : <AliIcon name="copy" size={11} />}
              {copied ? t("i18n.copied") : t("i18n.copy")}
            </button>
            {message.sendError && message.recoveryDraft && onEditFailed && (
              <button
                type="button"
                disabled={retryDisabled || retrying}
                onClick={() => {
                  if (retrying || retryDisabled) return;
                  setRetryError(null);
                  setRetrying(true);
                  void onEditFailed(message)
                    .catch(reason => setRetryError(reason instanceof Error ? reason.message : String(reason)))
                    .finally(() => setRetrying(false));
                }}
                style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "var(--text-xs)" }}
              >
                <AliIcon name="history" size={11} />{t("i18n.editFromHere")}
              </button>
            )}
            {messageActions}
          </div>
          {(canFork || canNavigate) && (
            <div style={{
              display: "flex", gap: 3,
              opacity: (hovered || forking) ? 1 : 0,
              pointerEvents: (hovered || forking) ? "auto" : "none",
              transition: "opacity 0.12s",
            }}>
              {canNavigate && (
                <button
                  disabled={retrying || retryDisabled}
                  onClick={() => {
                    if (retrying || retryDisabled) return;
                    setRetrying(true);
                    setRetryError(null);
                    void loadFullContent().then(async (fullContent) => {
                      if (await onNavigate!(prevAssistantEntryId!)) onEditContent?.(fullContent);
                    }).catch(reason => setRetryError(reason instanceof Error ? reason.message : String(reason)))
                      .finally(() => setRetrying(false));
                  }}
                  title={t("i18n.editFromHereTitle")}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: 22,
                    background: "none", border: "none",
                    borderRadius: "var(--radius-control)",
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: "var(--text-xs)", fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <AliIcon name="history" size={11} />
                  {t("i18n.editFromHere")}
                </button>
              )}
              {canFork && (
                <button
                  onClick={() => { onFork!(entryId!); }}
                  disabled={forking}
                  title={forking ? t("i18n.creatingSession") : t("i18n.newSessionTitle")}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: 22,
                    background: "none", border: "none",
                    borderRadius: "var(--radius-control)",
                    color: forking ? "var(--accent)" : "var(--text-dim)",
                    cursor: forking ? "not-allowed" : "pointer",
                    fontSize: "var(--text-xs)", fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!forking) e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { if (!forking) e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <AliIcon name="fork" size={11} />
                  {forking ? t("i18n.creating") : t("i18n.newSession")}
                </button>
              )}
            </div>
          )}
          {time && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>{time}</span>}
        </div>
      )}
    </div>
  );
}
