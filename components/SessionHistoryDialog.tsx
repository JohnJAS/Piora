"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";

type HistoryAppearance = "light" | "dark";

interface SessionHistoryDialogProps {
  sessionId: string;
  sessionName?: string | null;
  appearance: HistoryAppearance;
  onClose: () => void;
}

type LoadState = "loading" | "ready" | "error";

export function SessionHistoryDialog({
  sessionId,
  sessionName,
  appearance,
  onClose,
}: SessionHistoryDialogProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameVersion, setFrameVersion] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  useFocusTrap(dialogRef, true, { initialFocus: closeButtonRef, onEscape: onClose });

  const encodedSessionId = useMemo(() => encodeURIComponent(sessionId), [sessionId]);
  const embeddedUrl = useMemo(
    () => `/api/sessions/${encodedSessionId}/export?inline=1&embed=1&appearance=${appearance}&v=${frameVersion}`,
    [appearance, encodedSessionId, frameVersion],
  );
  const downloadUrl = `/api/sessions/${encodedSessionId}/export`;

  const reload = useCallback(() => {
    setLoadState("loading");
    setFrameVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleFrameMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data === "pi-session-history:escape") onClose();
    };
    window.addEventListener("message", handleFrameMessage);
    return () => window.removeEventListener("message", handleFrameMessage);
  }, [onClose]);

  return createPortal(
    <div
      className="session-history-backdrop app-shell-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="session-history-dialog app-shell-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-history-dialog-title"
        aria-describedby="session-history-dialog-description"
      >
        <header className="session-history-header app-shell-dialog-header">
          <span className="session-history-icon" aria-hidden="true">
            <AliIcon name="history" size={18} />
          </span>
          <div className="session-history-heading">
            <h2 id="session-history-dialog-title">{t("history.dialogTitle")}</h2>
            <p id="session-history-dialog-description">
              <span>{sessionName || t("history.untitled")}</span>
              <span aria-hidden="true">·</span>
              <span>{t("history.dialogDescription")}</span>
            </p>
          </div>
          <div className="session-history-actions">
            <a
              className="session-history-action"
              href={downloadUrl}
              download
              title={t("history.download")}
            >
              <AliIcon name="download" size={15} />
              <span className="session-history-action-label">{t("history.download")}</span>
            </a>
            <button
              className="session-history-action session-history-icon-action"
              type="button"
              onClick={reload}
              title={t("history.reload")}
              aria-label={t("history.reload")}
            >
              <AliIcon name="reload" size={15} />
            </button>
            <button
              ref={closeButtonRef}
              className="session-history-action session-history-icon-action"
              type="button"
              onClick={onClose}
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
            >
              <AliIcon name="close" size={16} />
            </button>
          </div>
        </header>

        <div className="session-history-body app-shell-dialog-body">
          {loadState === "loading" ? (
            <div className="session-history-state" role="status">
              <AliIcon className="animate-spin" name="reload" size={18} />
              <span>{t("history.loading")}</span>
            </div>
          ) : null}
          {loadState === "error" ? (
            <div className="session-history-state is-error" role="alert">
              <AliIcon name="warning" size={18} />
              <span>{t("history.loadError")}</span>
              <button type="button" onClick={reload}>{t("history.retry")}</button>
            </div>
          ) : null}
          <iframe
            key={`${sessionId}:${frameVersion}`}
            ref={frameRef}
            className={`session-history-frame${loadState === "ready" ? " is-ready" : ""}`}
            src={embeddedUrl}
            title={t("history.frameTitle")}
            sandbox="allow-scripts allow-downloads"
            onLoad={() => setLoadState("ready")}
            onError={() => setLoadState("error")}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
