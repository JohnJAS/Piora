"use client";

import type { RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import editorStyles from "../FileEditor.module.css";
import type { ConflictDecision, FileConflictData } from "./shared";

export function FileConflictBanner({
  externalChange,
  conflictDecision,
  saving,
  conflictConfirmRef,
  onSetConflictDecision,
  onKeepEditing,
  onReloadFromDisk,
  onOverwriteDisk,
}: {
  externalChange: FileConflictData;
  conflictDecision: ConflictDecision | null;
  saving: boolean;
  conflictConfirmRef: RefObject<HTMLButtonElement | null>;
  onSetConflictDecision: (decision: ConflictDecision | null) => void;
  onKeepEditing: () => void;
  onReloadFromDisk: () => void;
  onOverwriteDisk: () => void;
}) {
  const { t } = useI18n();
  const externalChangeMessage = externalChange.notice === "refreshFailed"
    ? t("fileEditor.refreshFailed", { error: externalChange.error ?? t("i18n.unknown") })
    : t("fileEditor.externalChangeBody");

  return (
    <div
      className={editorStyles.conflictBanner}
      role="alert"
      aria-live="polite"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !conflictDecision) return;
        event.preventDefault();
        onSetConflictDecision(null);
      }}
    >
      <div className={`${editorStyles.noticeCopy} ${conflictDecision ? editorStyles.confirmationCopy : ""}`}>
        <strong>
          {conflictDecision === "reload"
            ? t("fileEditor.reloadConfirmTitle")
            : conflictDecision === "overwrite"
              ? t("fileEditor.overwriteConfirmTitle")
              : t("fileEditor.externalChangeTitle")}
        </strong>
        <span>
          {conflictDecision === "reload"
            ? t("fileEditor.reloadConfirmBody")
            : conflictDecision === "overwrite"
              ? t("fileEditor.overwriteConfirmBody")
              : externalChangeMessage}
        </span>
      </div>
      <div className={editorStyles.noticeActions}>
        {conflictDecision ? (
          <>
            <button type="button" onClick={() => onSetConflictDecision(null)} disabled={saving}>
              {t("i18n.cancel")}
            </button>
            <button
              ref={conflictConfirmRef}
              type="button"
              className={editorStyles.dangerAction}
              onClick={conflictDecision === "reload" ? onReloadFromDisk : onOverwriteDisk}
              disabled={saving}
            >
              {conflictDecision === "reload" ? t("fileEditor.confirmReload") : t("fileEditor.confirmOverwrite")}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onKeepEditing} disabled={saving}>
              {t("fileEditor.keepEditing")}
            </button>
            <button type="button" onClick={() => onSetConflictDecision("reload")} disabled={saving}>
              {t("fileEditor.reloadDisk")}
            </button>
            <button
              type="button"
              className={editorStyles.dangerAction}
              onClick={() => onSetConflictDecision("overwrite")}
              disabled={saving}
            >
              {t("fileEditor.overwrite")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function FileSaveErrorBanner({
  saveError,
  onRetry,
  onDismiss,
}: {
  saveError: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={editorStyles.errorBanner} role="alert">
      <span><strong>{t("fileEditor.saveFailed")}</strong> {saveError}</span>
      <div className={editorStyles.noticeActions}>
        <button type="button" onClick={onRetry}>{t("fileEditor.tryAgain")}</button>
        <button type="button" onClick={onDismiss} aria-label={t("fileEditor.dismissSaveError")}>{t("fileEditor.dismiss")}</button>
      </div>
    </div>
  );
}
