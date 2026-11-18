"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { DshPetAction } from "@/desktop/src/dsh-pet-types";
import type { DesktopExtensionEntry, DesktopExtensionId, DesktopExtensionPreferences, DesktopExtensionState } from "@/desktop/src/desktop-extension-registry";
import styles from "./DesktopExtensionsSettings.module.css";
import settingsStyles from "./SettingsDialog.module.css";

function ExtensionCard({ entry, update }: {
  entry: DesktopExtensionEntry;
  update: (id: DesktopExtensionId, state: DesktopExtensionState) => void;
}) {
  const { t } = useI18n();
  const { manifest, state } = entry;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const capabilities: readonly string[] = manifest.capabilities;
  const pet = manifest.id === "dsh-pet";
  const canCancel = state?.phase === "installing" || state?.phase === "starting";
  const busy = pending || canCancel || state?.phase === "stopping";

  async function change(command: DshPetAction | DesktopExtensionPreferences) {
    const bridge = window.piDesktop?.desktopExtensions;
    if (!bridge || !state || (busy && command !== "cancel" && command !== "folder")) return;
    setPending(true);
    setError(undefined);
    try {
      const next = typeof command === "string"
        ? await bridge.action(manifest.id, command)
        : await bridge.preferences(manifest.id, command);
      update(manifest.id, next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }

  const options = capabilities.includes("sync-tasks") ? ["autoStart", "syncTasks"] as const : ["autoStart"] as const;
  return <article className={styles.card} data-desktop-extension={manifest.id}>
    <div className={styles.header}>
      <div>
        <h3>{manifest.name}</h3>
        <p>{manifest.version} · {t("desktopExtensions.compatibility")}</p>
      </div>
      <span role="status">{t(state ? `desktopExtensions.state.${state.phase}` : "desktopExtensions.unavailable")}</span>
    </div>
    <p>{t(pet ? "desktopExtensions.petDescription" : "desktopExtensions.memeDescription")}</p>
    {state?.progress && <p role="status">{t(`desktopExtensions.progress.${state.progress.stage}`)}
      {state.progress.total ? ` ${Math.floor(state.progress.received / state.progress.total * 100)}%` : ""}</p>}
    <div className={styles.actions}>
      {canCancel && <button type="button" disabled={pending} onClick={() => void change("cancel")}>{t("common.cancel")}</button>}
      {!state?.installed && <button type="button" disabled={!state || busy} onClick={() => void change("install")}>
        {t(pet ? "desktopExtensions.install" : "memes.install")}
      </button>}
      {state?.installed && <>
        <button type="button" disabled={busy} onClick={() => void change(state.phase === "running" ? "stop" : "start")}>
          {t(state.phase === "running" ? "desktopExtensions.stop" : "desktopExtensions.start")}
        </button>
        <button type="button" disabled={busy || state.phase !== "running"} onClick={() => void change("settings")}>
          {t(pet ? "desktopExtensions.settings" : "memes.manage")}
        </button>
        <button type="button" disabled={busy} onClick={() => void change("uninstall")}>{t("desktopExtensions.uninstall")}</button>
      </>}
      {capabilities.includes("data-folder") && <button type="button" disabled={!state || pending} onClick={() => void change("folder")}>
        {t("desktopExtensions.folder")}
      </button>}
    </div>
    {options.map(key => {
      const label = t(`desktopExtensions.${key}`);
      const checked = state?.[key] ?? (key === "syncTasks");
      return <div className={styles.option} key={key}>
        <span>{label}</span>
        <button type="button" role="switch" className={settingsStyles.switch}
          aria-label={label} aria-checked={checked} disabled={!state?.installed || busy}
          onClick={() => void change({ [key]: !checked })}><span /></button>
      </div>;
    })}
    {pet && <>
      <p className={styles.description}>{t("desktopExtensions.capabilities")}</p>
      <p className={styles.description}>{t("desktopExtensions.firstRun")}</p>
    </>}
    <p className={styles.description}>
      {pet && <>{t("desktopExtensions.license")} </>}
      <a href={manifest.source} target="_blank" rel="noreferrer">{t(pet ? "desktopExtensions.source" : "desktopExtensions.memeSource")}</a>
    </p>
    {(error || state?.error) && <p className={styles.error} role="alert">{error || state?.error}</p>}
  </article>;
}

export function DesktopExtensionsSettings() {
  const { t } = useI18n();
  const [available, setAvailable] = useState<boolean>();
  const [entries, setEntries] = useState<DesktopExtensionEntry[]>();
  const [error, setError] = useState<string>();
  const viewVersion = useRef(0);
  const update = useCallback((id: DesktopExtensionId, state: DesktopExtensionState) => {
    viewVersion.current++;
    setEntries(current => current?.map(entry => entry.manifest.id === id ? { ...entry, state } : entry));
  }, []);

  useEffect(() => {
    const bridge = window.piDesktop?.desktopExtensions;
    setAvailable(Boolean(bridge));
    if (!bridge) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = viewVersion.current;
      try {
        if (document.visibilityState !== "hidden") {
          const result = await bridge.list();
          if (!disposed && viewVersion.current === version) {
            setEntries(result);
            setError(undefined);
          }
        }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!disposed) timer = setTimeout(poll, 1500);
      }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, []);

  return <section className={`${styles.root} settings-embedded-surface`} data-settings-id="desktopExtensions">
    <h2>{t("desktopExtensions.title")}</h2>
    <p className={styles.description}>{t("desktopExtensions.description")}</p>
    {available === false && <p role="status">{t("desktopExtensions.desktopOnly")}</p>}
    {available !== false && !entries && !error && <p role="status">{t("desktopExtensions.loading")}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {entries?.map(entry => <ExtensionCard key={entry.manifest.id} entry={entry} update={update} />)}
  </section>;
}
