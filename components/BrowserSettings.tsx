"use client";

import { useCallback, useEffect, useState } from "react";
import type { BrowserDownloadPreferences } from "@/desktop/src/browser-preferences";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import { ProfileSettingsHome } from "./workspace/browser/BrowserProfileSection";
import { reopenFromSettings, type ToolsBridge } from "./workspace/browser/shared";
import styles from "./SettingsDialog.module.css";

export function BrowserSettings({ requestedPage }: { requestedPage?: string } = {}) {
  const bridge = typeof window === "undefined" ? undefined : window.piDesktop?.browser;
  const content = <BrowserPreferences />;
  return bridge?.tools ? <ProfileSettingsHome requestedPage={requestedPage} bridge={bridge as ToolsBridge} navigate={reopenFromSettings}>{content}</ProfileSettingsHome> : content;
}

function BrowserPreferences() {
  const { t } = useI18n();
  const [preferences, setPreferences] = useState<BrowserDownloadPreferences | null>(null);
  const [directory, setDirectory] = useState("");
  const [askEachTime, setAskEachTime] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"" | "saved" | "error">("");
  const apply = useCallback((value: BrowserDownloadPreferences) => {
    setPreferences(value);
    setDirectory(value.directory);
    setAskEachTime(value.askEachTime);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const request = window.piDesktop?.browser?.getPreferences?.();
    if (!request) { setStatus("error"); return; }
    void request.then(value => { if (!cancelled) apply(value); }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [apply]);
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
  const disabled = !preferences || busy;
  return (
    <>
      <div className={styles.contentHeading}>
        <h2>{t("browserPreferences.title")}</h2>
        <p>{t("browserPreferences.description")}</p>
      </div>
      <section data-settings-id="browser.downloads" className={`${styles.promptCard} ${styles.browserPreferencesCard}`} aria-labelledby="browser-download-label">
        <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className={styles.browserDownloadPath}>
            <label id="browser-download-label" className={styles.rowTitle} htmlFor="browser-download-directory">
              {t("browserPreferences.directory")}
            </label>
            <div className={styles.agentDataInputRow}>
              <input
                id="browser-download-directory"
                value={directory}
                placeholder={preferences?.effectiveDirectory}
                aria-describedby={preferences ? "browser-download-effective" : undefined}
                disabled={disabled}
                spellCheck={false}
                onChange={event => { setDirectory(event.target.value); setStatus(""); }}
              />
              <button className={styles.secondaryButton} type="button" disabled={disabled} onClick={() => void browse()}>
                <AliIcon name="folder-open" size={15} />
                {t("browserPreferences.browse")}
              </button>
            </div>
            {preferences ? (
              <p id="browser-download-effective" className={styles.agentDataMeta}>
                {t("browserPreferences.effective", { path: preferences.effectiveDirectory })}
              </p>
            ) : null}
          </div>
          <div className={styles.browserPreferenceRow}>
            <label className={styles.rowTitle} htmlFor="browser-download-ask">{t("browserPreferences.ask")}</label>
            <button
              id="browser-download-ask"
              className={styles.switch}
              type="button"
              role="switch"
              aria-checked={askEachTime}
              aria-label={t("browserPreferences.ask")}
              disabled={disabled}
              onClick={() => { setAskEachTime(value => !value); setStatus(""); }}
            ><span /></button>
          </div>
          <div className={styles.browserPreferenceFooter}>
            {status ? (
              <p className={styles.browserPreferenceStatus} role={status === "error" ? "alert" : "status"}>
                {t(status === "saved" ? "browserPreferences.saved" : "browserPreferences.failed")}
              </p>
            ) : null}
            <div className={styles.browserPreferenceActions}>
              <button className={styles.secondaryButton} type="button" disabled={disabled} onClick={() => void save(true)}>
                {t("browserPreferences.reset")}
              </button>
              <button className={styles.primaryButton} type="submit" disabled={disabled}>
                {t("browserPreferences.save")}
              </button>
            </div>
          </div>
        </form>
      </section>
      <section className={`${styles.promptCard} ${styles.browserPreferencesCard}`} aria-labelledby="browser-zoom-label">
        <div className={styles.promptCardHeader}>
          <h3 id="browser-zoom-label">{t("browserPreferences.zoom")}</h3>
          <p>{t("browserPreferences.zoomHelp")}</p>
        </div>
      </section>
    </>
  );
}
