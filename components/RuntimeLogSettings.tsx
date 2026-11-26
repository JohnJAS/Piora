"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import type { LogSettings, RuntimeLogInfo } from "@/desktop/src/logger";
import { SettingsDisclosure, SettingsRow, SettingsSection } from "./settings/SettingsPrimitives";
import primitiveStyles from "./settings/SettingsPrimitives.module.css";

export function RuntimeLogSettings() {
  const { t } = useI18n();
  const [info, setInfo] = useState<RuntimeLogInfo | null>(null);
  const [draft, setDraft] = useState<LogSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<"idle" | "copying" | "copied" | "opening" | "copyFailed" | "openFailed">("idle");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setInfo(null);
      setAction("idle");
      try {
        const result = await window.piDesktop?.getRuntimeLog?.();
        if (!cancelled) { setInfo(result ?? null); setDraft(result?.settings ?? null); }
      } catch {
        if (!cancelled) setInfo(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [revision]);

  const copyPath = async () => {
    if (!info) return;
    setAction("copying");
    try {
      await copyText(info.filePath);
      setAction("copied");
    } catch {
      setAction("copyFailed");
    }
  };

  const revealLog = async () => {
    if (!info) return;
    setAction("opening");
    try {
      const opened = await window.piDesktop?.revealPath?.(info.filePath);
      setAction(opened ? "idle" : "openFailed");
    } catch {
      setAction("openFailed");
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setFeedback(""); setFailed(false);
    try {
      const result = await window.piDesktop?.setRuntimeLog?.(draft);
      if (!result?.ok || !result.info) throw new Error(result?.error || t("settings.runtimeLog.unavailable"));
      setInfo(result.info); setDraft(result.info.settings); setFeedback(t("settings.runtimeLog.saved"));
    } catch (error) { setFailed(true); setFeedback(String(error)); }
    finally { setSaving(false); }
  };
  const busy = saving || loading || action === "copying" || action === "opening";
  return (
    <SettingsSection settingsId="general.runtimeLog">
      <SettingsRow
        title={t("settings.runtimeLog.title")}
        description={
          <>
            {info ? (
              <>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "calc(var(--text-xs) * 0.94)", overflowWrap: "anywhere" }}>
                  {info.filePath}
                </div>
                <div role="status" style={{ marginTop: 3 }}>
                  {info.fileLoggingAvailable
                    ? t("settings.runtimeLog.effective", { level: info.settings.level, size: info.settings.maxSizeMiB, count: info.settings.backups })
                    : t("settings.runtimeLog.unwritable")}
                </div>
              </>
            ) : (
              <div role="status">{t(loading ? "settings.runtimeLog.loading" : "settings.runtimeLog.unavailable")}</div>
            )}
            {action === "copyFailed" || action === "openFailed" ? (
              <div className={primitiveStyles.statusError} role="alert">{t(`settings.runtimeLog.${action}`)}</div>
            ) : null}
          </>
        }
      >
        <button type="button" className={primitiveStyles.button} disabled={!info || busy} onClick={() => { void copyPath(); }}>
          {t(action === "copied" ? "settings.runtimeLog.copied" : "settings.runtimeLog.copy")}
        </button>
        <button type="button" className={primitiveStyles.button} disabled={!info?.fileLoggingAvailable || busy} onClick={() => { void revealLog(); }}>
          {t("settings.runtimeLog.openFolder")}
        </button>
        <button type="button" className={primitiveStyles.button} disabled={busy} onClick={() => setRevision(value => value + 1)}>
          {t("settings.runtimeLog.refresh")}
        </button>
      </SettingsRow>

      {draft && info ? (
        <SettingsDisclosure
          summary={t("settings.runtimeLog.configure")}
          meta={t("settings.runtimeLog.effective", { level: info.settings.level, size: info.settings.maxSizeMiB, count: info.settings.backups })}
        >
          <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 12 }}>
            <label className={primitiveStyles.field}>
              <span className={primitiveStyles.fieldLabel}>{t("settings.runtimeLog.directory")}</span>
              <input className={primitiveStyles.input} value={draft.directory} onChange={event => setDraft({ ...draft, directory: event.target.value })} />
            </label>
            <div className={primitiveStyles.gridTwo}>
              <label className={primitiveStyles.field}>
                <span className={primitiveStyles.fieldLabel}>{t("settings.runtimeLog.level")}</span>
                <select className={primitiveStyles.input} value={draft.level} onChange={event => setDraft({ ...draft, level: event.target.value as LogSettings["level"] })}>
                  {["error", "warn", "info", "debug"].map(level => <option key={level}>{level}</option>)}
                </select>
              </label>
              <label className={primitiveStyles.field}>
                <span className={primitiveStyles.fieldLabel}>{t("settings.runtimeLog.size")}</span>
                <input className={primitiveStyles.input} type="number" min={1} max={100} value={draft.maxSizeMiB} onChange={event => setDraft({ ...draft, maxSizeMiB: Number(event.target.value) })} />
              </label>
              <label className={primitiveStyles.field}>
                <span className={primitiveStyles.fieldLabel}>{t("settings.runtimeLog.backups")}</span>
                <input className={primitiveStyles.input} type="number" min={1} max={20} value={draft.backups} onChange={event => setDraft({ ...draft, backups: Number(event.target.value) })} />
              </label>
            </div>
            <div className={primitiveStyles.compactFooter}>
              <div className={primitiveStyles.modalActions}>
                <button type="button" className={primitiveStyles.button} onClick={() => {
                  void (async () => {
                    try { const directory = await window.piDesktop?.selectDirectory(); if (directory) setDraft(current => current ? { ...current, directory } : current); }
                    catch (error) { setFailed(true); setFeedback(String(error)); }
                  })();
                }}>{t("settings.runtimeLog.choose")}</button>
                <button type="button" className={primitiveStyles.button} onClick={() => setDraft({ directory: info.defaultDirectory, level: "info", maxSizeMiB: 5, backups: 1 })}>
                  {t("settings.runtimeLog.defaults")}
                </button>
              </div>
              <button type="button" className={primitiveStyles.buttonPrimary} onClick={() => { void save(); }}>
                {t("settings.runtimeLog.save")}
              </button>
            </div>
            {feedback ? <div role={failed ? "alert" : "status"} className={failed ? primitiveStyles.statusError : primitiveStyles.statusText}>{feedback}</div> : null}
          </fieldset>
        </SettingsDisclosure>
      ) : null}
    </SettingsSection>
  );
}
