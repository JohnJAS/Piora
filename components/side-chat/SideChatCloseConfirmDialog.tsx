"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import styles from "./SideChat.module.css";

interface Props {
  open: boolean;
  onCancel: () => void;
  onConfirm: (dontAskAgain: boolean) => void;
}

/** Confirmation modal matching Codex Desktop when discarding an active temporary side chat. */
export function SideChatCloseConfirmDialog({ open, onCancel, onConfirm }: Props) {
  const { t } = useI18n();
  const [dontAskAgain, setDontAskAgain] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDontAskAgain(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div
        className={styles.dialogCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby="side-chat-close-confirm-title"
        aria-describedby="side-chat-close-confirm-description"
      >
        <h3 id="side-chat-close-confirm-title" className={styles.stateTitle}>
          {t("sideChat.closeConfirmTitle")}
        </h3>
        <p id="side-chat-close-confirm-description" className={styles.stateDescription}>
          {t("sideChat.closeConfirmDescription")}
        </p>
        <label className={styles.dialogCheckbox}>
          <input
            type="checkbox"
            checked={dontAskAgain}
            onChange={(event) => setDontAskAgain(event.target.checked)}
          />
          <span>{t("sideChat.dontAskAgain")}</span>
        </label>
        <div className={styles.dialogFooter}>
          <button type="button" className={styles.secondaryButton} onClick={onCancel}>
            {t("sideChat.cancel")}
          </button>
          <button type="button" className={styles.primaryButton} onClick={() => onConfirm(dontAskAgain)}>
            {t("sideChat.confirmClose")}
          </button>
        </div>
      </div>
    </div>
  );
}
