"use client";

import React from "react";
import type { AttachedFile, CompactResultInfo } from "@/hooks/useAgentSession";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import { CompactionProgress, CompactionResult } from "../CompactionProgress";
import { MessageImage, MessageImageViewer } from "../MessageImage";
import { formatFileSize, type AttachedImage, type PromptOptimizationState } from "./shared";

function ModelNoticeBanner({ tone, title, body }: { tone: "error" | "warning"; title: string; body: string }) {
  const color = tone === "error" ? "239,68,68" : "234,179,8";
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        maxHeight: 120,
        marginBottom: 8,
        padding: "7px 10px",
        overflowY: "auto",
        border: `1px solid rgba(${color},0.3)`,
        borderRadius: "var(--radius-control)",
        background: `rgba(${color},0.07)`,
        color: `rgb(${color})`,
        fontSize: "var(--text-xs)",
        lineHeight: 1.45,
      }}
    >
      <AliIcon name="warning" size={13} style={{ marginTop: 1 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body}</div>
      </div>
    </div>
  );
}

export function ModelErrorBanner({ error, title = "模型错误" }: { error?: string | null; title?: string }) {
  if (!error) return null;
  return <ModelNoticeBanner tone="error" title={title} body={error} />;
}

export interface ComposerStatusBannersProps {
  modelError?: string | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  draftKey?: string;
  isCompacting?: boolean;
  compactionStartedAt?: number | null;
  onAbortCompaction?: () => void;
  compactResult?: CompactResultInfo | null;
  onDismissCompactResult?: () => void;
  compactError?: string | null;
  onDismissCompactError?: () => void;
}

export function ComposerStatusBanners({
  modelError,
  retryInfo,
  draftKey,
  isCompacting,
  compactionStartedAt = null,
  onAbortCompaction,
  compactResult,
  onDismissCompactResult,
  compactError,
  onDismissCompactError,
}: ComposerStatusBannersProps) {
  const { t } = useI18n();
  return (
    <>
      <ModelErrorBanner error={modelError} title={t("chat.modelError")} />
      {retryInfo && (
        <div style={{
          marginBottom: 8, padding: "5px 10px",
          background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
          borderRadius: "var(--radius-control)", fontSize: "var(--text-sm)", color: "rgba(180,130,0,0.9)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <AliIcon name="reload" size={11} />
          {t("chat.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })}
          {retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
        </div>
      )}
      {isCompacting ? <CompactionProgress key={draftKey} startedAt={compactionStartedAt} onStop={onAbortCompaction} /> : null}
      {!isCompacting && compactResult ? <CompactionResult result={compactResult} onDismiss={onDismissCompactResult} /> : null}
      {compactError && (
        <div
          className="composer-surface"
          role="alert"
          style={{
            marginBottom: 8,
            padding: "7px 10px",
            background: "rgba(239,68,68,0.07)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: "var(--radius-control)",
            color: "#ef4444",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            {compactError}
            <span style={{ display: "block", marginTop: 4, fontFamily: "inherit", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              {t("chat.compactErrorHint")}
            </span>
          </div>
          {onDismissCompactError && (
            <button
              type="button"
              onClick={onDismissCompactError}
              title={t("chat.dismissCompactError")}
              aria-label={t("chat.dismissCompactError")}
              style={{
                display: "inline-flex",
                width: 24,
                height: 24,
                flex: "none",
                alignItems: "center",
                justifyContent: "center",
                margin: -3,
                padding: 0,
                border: 0,
                borderRadius: "var(--radius-control)",
                background: "transparent",
                color: "currentColor",
                cursor: "pointer",
                opacity: 0.78,
              }}
            >
              <AliIcon name="close" size={12} />
            </button>
          )}
        </div>
      )}
    </>
  );
}

export interface ComposerAttachmentsBarProps {
  attachedImages: AttachedImage[];
  previewImage: { src: string; index: number } | null;
  onSetPreviewImage: (next: { src: string; index: number } | null) => void;
  onRemoveImage: (index: number) => void;
  attachedFiles: AttachedFile[];
  onRestorePastedFile: (index: number) => void;
  onRemoveFile: (index: number) => void;
}

export function ComposerAttachmentsBar({
  attachedImages,
  previewImage,
  onSetPreviewImage,
  onRemoveImage,
  attachedFiles,
  onRestorePastedFile,
  onRemoveFile,
}: ComposerAttachmentsBarProps) {
  const { t } = useI18n();
  return (
    <>
      {attachedImages.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          {attachedImages.map((img, i) => (
            <div key={i} style={{ position: "relative", flexShrink: 0 }}>
              <MessageImage
                src={img.previewUrl}
                index={i}
                className="composer-image-thumbnail"
                onOpen={() => onSetPreviewImage({ src: `data:${img.mimeType};base64,${img.data}`, index: i })}
              />
              <button
                type="button"
                onClick={() => onRemoveImage(i)}
                title={t("chat.removeAttachment")}
                aria-label={t("chat.removeAttachment")}
                style={{
                  position: "absolute", top: -4, right: -4,
                  width: 16, height: 16, borderRadius: "50%",
                  background: "var(--bg-panel)", border: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", padding: 0, color: "var(--text-muted)",
                }}
              >
                <AliIcon name="close" size={8} />
              </button>
            </div>
          ))}
        </div>
      )}
      {previewImage && <MessageImageViewer src={previewImage.src} index={previewImage.index} onClose={() => onSetPreviewImage(null)} />}

      {attachedFiles.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
          {attachedFiles.map((file, i) => (
            <div
              key={`${file.name}:${i}`}
              title={file.path ? `${file.path}\n${t("chat.attachedLocalHint")}` : file.text == null ? t("chat.attachmentMissingPath") : `${file.name} · ${formatFileSize(file.size)}`}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                maxWidth: 260, padding: "4px 6px 4px 8px",
                background: "var(--bg-panel)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)", fontSize: "var(--text-xs)", color: "var(--text-muted)",
              }}
            >
              <AliIcon name="file" size={12} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
                {file.name}
              </span>
              {file.path && <span style={{ flexShrink: 0, color: "var(--text-dim)" }}>{formatFileSize(file.size)}</span>}
              {file.kind === "paste" && (
                <button
                  type="button"
                  onClick={() => onRestorePastedFile(i)}
                  title={t("chat.restorePasteToComposer")}
                  aria-label={t("chat.restorePasteToComposer")}
                  style={{
                    flexShrink: 0, padding: "1px 4px", border: "none", borderRadius: 4,
                    background: "transparent", color: "var(--accent)", cursor: "pointer",
                    fontSize: "var(--text-xs)", whiteSpace: "nowrap",
                  }}
                >
                  {t("chat.showInComposer")}
                </button>
              )}
              <button
                onClick={() => onRemoveFile(i)}
                title={t("chat.removeAttachment")}
                aria-label={t("chat.removeAttachment")}
                style={{
                  flexShrink: 0, width: 16, height: 16, padding: 0, border: "none", borderRadius: "50%",
                  background: "transparent", color: "var(--text-muted)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <AliIcon name="close" size={8} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function PromptOptimizationReview({
  state,
  onKeepOriginal,
  onUseOptimized,
}: {
  state: PromptOptimizationState;
  onKeepOriginal: () => void;
  onUseOptimized: (result: string) => void;
}) {
  const { t } = useI18n();
  if (state.loading) return null;
  return (
    <div
      className={`prompt-optimization-review${state.error ? " is-error" : ""}`}
      role={state.error ? "alert" : "region"}
      aria-label={t("chat.optimizedPrompt")}
    >
      <div className="prompt-optimization-header">
        <span className="prompt-optimization-title">
          <AliIcon name={state.error ? "warning" : "solution"} size={14} />
          {state.error ? t("chat.optimizePromptFailed") : t("chat.optimizedPrompt")}
        </span>
        <div className="prompt-optimization-actions">
          <button type="button" onClick={onKeepOriginal}>
            {t("chat.keepOriginalPrompt")}
          </button>
          {state.result && (
            <button
              type="button"
              className="is-primary"
              onClick={() => onUseOptimized(state.result!)}
            >
              {t("chat.useOptimizedPrompt")}
            </button>
          )}
        </div>
      </div>
      <div className="prompt-optimization-content">
        {state.error ?? state.result}
      </div>
    </div>
  );
}
