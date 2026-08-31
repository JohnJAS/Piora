"use client";

import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useApplicationShortcuts } from "@/hooks/useApplicationShortcuts";
import { useI18n } from "@/hooks/useI18n";
import {
  APPLICATION_SHORTCUTS,
  formatShortcutBinding,
  isMacPlatform,
  recordShortcutFromEvent,
  type ApplicationShortcutId,
} from "@/lib/keyboard-shortcuts";
import { AliIcon } from "./AliIcon";
import styles from "./ShortcutSettings.module.css";

export function ShortcutSettings() {
  const { t } = useI18n();
  const { bindings, overrides, setBinding, resetBinding, resetAll } = useApplicationShortcuts();
  const [recording, setRecording] = useState<ApplicationShortcutId | null>(null);
  const [error, setError] = useState<{ type: "conflict"; conflict: ApplicationShortcutId } | { type: "reserved"; binding: string } | null>(null);
  const mac = isMacPlatform(window.piDesktop?.platform);

  const capture = (id: ApplicationShortcutId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(null);
      setError(null);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      setBinding(id, null);
      setRecording(null);
      setError(null);
      return;
    }
    const binding = recordShortcutFromEvent(event.nativeEvent, mac);
    if (!binding) return;
    const result = setBinding(id, binding);
    if (!result.ok) {
      setError("reserved" in result
        ? { type: "reserved", binding }
        : { type: "conflict", conflict: result.conflict });
      return;
    }
    setError(null);
    setRecording(null);
  };

  const titleFor = (id: ApplicationShortcutId) => t(APPLICATION_SHORTCUTS.find((item) => item.id === id)?.titleKey ?? id);

  return (
    <div className={styles.surface} data-testid="shortcut-settings">
      <header className={styles.heading}>
        <div>
          <h2>{t("settings.shortcuts")}</h2>
          <p>{t("settings.shortcutsDescription")}</p>
        </div>
        <button type="button" className={styles.resetAll} onClick={() => { resetAll(); setError(null); setRecording(null); }}>
          {t("shortcuts.resetAll")}
        </button>
      </header>
      <div className={styles.list}>
        {APPLICATION_SHORTCUTS.map((item) => {
          const isRecording = recording === item.id;
          return (
            <div className={styles.row} key={item.id}>
              <div className={styles.copy}>
                <strong>{t(item.titleKey)}</strong>
                <span>{t(item.descriptionKey)}</span>
              </div>
              <button
                type="button"
                className={styles.recorder}
                data-recording={isRecording}
                data-app-shortcuts="preserve"
                aria-label={t("shortcuts.recordLabel", { command: t(item.titleKey) })}
                onClick={() => { setRecording(item.id); setError(null); }}
                onBlur={() => setRecording((current) => current === item.id ? null : current)}
                onKeyDown={(event) => isRecording && capture(item.id, event)}
              >
                <kbd>{isRecording ? t("shortcuts.recording") : formatShortcutBinding(bindings[item.id], mac) || t("shortcuts.unassigned")}</kbd>
              </button>
              <button
                type="button"
                className={styles.resetOne}
                disabled={!Object.prototype.hasOwnProperty.call(overrides, item.id)}
                aria-label={t("shortcuts.resetOneLabel", { command: t(item.titleKey) })}
                title={t("shortcuts.resetOne")}
                onClick={() => { resetBinding(item.id); setError(null); }}
              >
                <AliIcon name="reload" size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className={`${styles.message} ${error ? styles.error : ""}`} role="status">
        {error?.type === "conflict"
          ? t("shortcuts.conflict", { shortcut: formatShortcutBinding(bindings[error.conflict], mac), command: titleFor(error.conflict) })
          : error?.type === "reserved"
            ? t("shortcuts.reserved", { shortcut: formatShortcutBinding(error.binding, mac) })
            : t("shortcuts.recordHint")}
      </div>
      <p className={styles.note}>{t("shortcuts.nativeFindNote")}</p>
    </div>
  );
}
