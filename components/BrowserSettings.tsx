"use client";

import { useEffect, useState } from "react";
import type { BrowserDownloadPreferences } from "@/desktop/src/browser-preferences";
import { useI18n } from "@/hooks/useI18n";
import styles from "./SettingsDialog.module.css";

export function BrowserSettings() {
  const { t } = useI18n();
  const [preferences, setPreferences] = useState<BrowserDownloadPreferences | null>(null);
  const [directory, setDirectory] = useState("");
  const [askEachTime, setAskEachTime] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"" | "saved" | "error">("");
  const apply = (value: BrowserDownloadPreferences) => { setPreferences(value); setDirectory(value.directory); setAskEachTime(value.askEachTime); };
  useEffect(() => {
    let cancelled = false;
    const request = window.piDesktop?.browser?.getPreferences?.();
    if (!request) { setStatus("error"); return; }
    void request.then(value => { if (!cancelled) apply(value); }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, []);
  const save = async (reset = false) => {
    const update = window.piDesktop?.browser?.setPreferences;
    if (!update || busy) return;
    setBusy(true); setStatus("");
    try { apply(await update({ directory: reset ? "" : directory, askEachTime })); setStatus("saved"); }
    catch { setStatus("error"); }
    finally { setBusy(false); }
  };
  const browse = async () => {
    setBusy(true); setStatus("");
    try { const selected = await window.piDesktop?.selectDirectory(); if (selected) setDirectory(selected); }
    catch { setStatus("error"); }
    finally { setBusy(false); }
  };
  return <section data-settings-id="browser.downloads" className={styles.conversationSection}>
    <div className={styles.contentHeading}><h2>{t("browserPreferences.title")}</h2><p>{t("browserPreferences.description")}</p></div>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <label htmlFor="browser-download-directory">{t("browserPreferences.directory")}</label>
      <div style={{ display: "flex", gap: 8, marginBlock: 8 }}>
        <input id="browser-download-directory" value={directory} placeholder={preferences?.effectiveDirectory} disabled={!preferences || busy} style={{ flex: 1, minWidth: 0 }} onChange={event => { setDirectory(event.target.value); setStatus(""); }} />
        <button type="button" disabled={!preferences || busy} onClick={() => void browse()}>{t("browserPreferences.browse")}</button>
      </div>
      {preferences ? <p style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>{t("browserPreferences.effective", { path: preferences.effectiveDirectory })}</p> : null}
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBlock: 12 }}><input type="checkbox" checked={askEachTime} disabled={!preferences || busy} onChange={event => { setAskEachTime(event.target.checked); setStatus(""); }} />{t("browserPreferences.ask")}</label>
      <div style={{ display: "flex", gap: 8 }}><button type="submit" disabled={!preferences || busy}>{t("browserPreferences.save")}</button><button type="button" disabled={!preferences || busy} onClick={() => void save(true)}>{t("browserPreferences.reset")}</button></div>
      {status ? <p role={status === "error" ? "alert" : "status"}>{t(status === "saved" ? "browserPreferences.saved" : "browserPreferences.failed")}</p> : null}
    </form>
    <p style={{ color: "var(--text-muted)", marginTop: 20 }}>{t("browserPreferences.zoomHelp")}</p>
  </section>;
}
