"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SpeechStatus } from "@/lib/speech-types";
import { AliIcon } from "./AliIcon";
import styles from "./SpeechSettings.module.css";

const SPEECH_SETTINGS_CHANGED_EVENT = "piora:speech-settings-changed";

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  return typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
}

export function SpeechSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState<SpeechStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/speech/settings", { cache: "no-store" });
    if (!response.ok) throw new Error(await responseError(response));
    const next = await response.json() as SpeechStatus;
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load()
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (status?.install.phase !== "downloading" && status?.install.phase !== "installing") return;
    const timer = window.setInterval(() => {
      void load().catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [load, status?.install.phase]);

  const patchSettings = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/speech/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const next = await response.json() as SpeechStatus;
    setStatus(next);
    window.dispatchEvent(new Event(SPEECH_SETTINGS_CHANGED_EVENT));
  }, []);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusy(false);
    }
  }, []);

  const install = () => runAction(async () => {
    const response = await fetch("/api/speech/packs", { method: "POST" });
    if (!response.ok) throw new Error(await responseError(response));
    await load();
  });

  const remove = () => runAction(async () => {
    const response = await fetch("/api/speech/packs", { method: "DELETE" });
    if (!response.ok) throw new Error(await responseError(response));
    setStatus(await response.json() as SpeechStatus);
    window.dispatchEvent(new Event(SPEECH_SETTINGS_CHANGED_EVENT));
  });

  const chooseDirectory = () => runAction(async () => {
    const selected = await window.piDesktop?.selectSpeechPackDirectory?.(status?.packDirectory);
    if (selected) await patchSettings({ packDirectory: selected });
  });

  const installActive = status?.install.phase === "downloading" || status?.install.phase === "installing";
  const progress = status && status.install.totalBytes > 0
    ? Math.min(100, Math.round(status.install.downloadedBytes / status.install.totalBytes * 100))
    : 0;

  if (loading && !status) {
    return <div className={styles.loading}>{t("speech.loading")}</div>;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h2>{t("speech.title")}</h2>
          <p>{t("speech.description")}</p>
        </div>
        <span className={styles.privacyBadge}><AliIcon name="lock" size={14} />{t("speech.offlineBadge")}</span>
      </header>

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {status?.install.phase === "error" && status.install.error
        ? <div className={styles.error} role="alert">{status.install.error}</div>
        : null}

      <section className={styles.card}>
        <div className={styles.toggleRow}>
          <div>
            <h3>{t("speech.toggle")}</h3>
            <p>{t("speech.toggleDescription")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={status?.enabled ?? false}
            className={styles.switch}
            data-enabled={status?.enabled || undefined}
            disabled={busy || !status?.installed || !status.hardware.supported}
            onClick={() => runAction(() => patchSettings({ enabled: !status?.enabled }))}
          >
            <span />
          </button>
        </div>
        {!status?.installed ? <p className={styles.hint}>{t("speech.installBeforeEnable")}</p> : null}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3>{t("speech.packTitle")}</h3>
            <p>{t("speech.packDescription")}</p>
          </div>
          <span className={status?.installed ? styles.ready : styles.notInstalled}>
            {status?.installed ? t("speech.installed") : t("speech.notInstalled")}
          </span>
        </div>

        <div className={styles.factGrid}>
          <div><span>{t("speech.engine")}</span><strong>sherpa-onnx · SenseVoiceSmall INT8</strong></div>
          <div><span>{t("speech.languages")}</span><strong>{status?.languages.join(" / ") ?? "—"}</strong></div>
          <div><span>{t("speech.downloadSize")}</span><strong>{formatBytes(status?.approximateDownloadBytes ?? null)}</strong></div>
          <div><span>{t("speech.diskUsage")}</span><strong>{formatBytes(status?.installedBytes ?? null)}</strong></div>
        </div>

        {installActive ? (
          <div className={styles.progressBlock}>
            <div><span>{status?.install.phase === "installing" ? t("speech.installing") : t("speech.downloading")}</span><strong>{progress}%</strong></div>
            <progress value={progress} max={100} />
            {status?.install.currentFile ? <small>{status.install.currentFile}</small> : null}
          </div>
        ) : null}

        <div className={styles.actions}>
          {!status?.installed ? (
            <button type="button" className={styles.primary} disabled={busy || installActive || !status?.hardware.supported} onClick={install}>
              <AliIcon name="download" size={14} />{t("speech.download")}
            </button>
          ) : (
            <button type="button" className={styles.danger} disabled={busy || installActive} onClick={remove}>
              <AliIcon name="delete" size={14} />{t("speech.remove")}
            </button>
          )}
        </div>
        <p className={styles.networkNote}>{t("speech.networkNote")}</p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3>{t("speech.environmentTitle")}</h3>
            <p>{t("speech.environmentDescription")}</p>
          </div>
        </div>
        <div className={styles.factGrid}>
          <div><span>{t("speech.platform")}</span><strong>{status ? `${status.hardware.platform} / ${status.hardware.arch}` : "—"}</strong></div>
          <div><span>{t("speech.cpu")}</span><strong>{status ? t("speech.cores", { count: status.hardware.logicalCores }) : "—"}</strong></div>
          <div><span>{t("speech.memory")}</span><strong>{status ? `${status.hardware.memoryGiB} GiB` : "—"}</strong></div>
          <div><span>{t("speech.strategy")}</span><strong>{status ? t(`speech.tier.${status.hardware.tier}`, { threads: status.hardware.threads }) : "—"}</strong></div>
        </div>
        {status && !status.hardware.supported ? <p className={styles.unsupported}>{t("speech.unsupportedEnvironment")}</p> : null}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h3>{t("speech.locationTitle")}</h3>
            <p>{t("speech.locationDescription")}</p>
          </div>
        </div>
        <div className={styles.pathRow}>
          <code>{status?.packDirectory ?? "—"}</code>
          {window.piDesktop?.selectSpeechPackDirectory ? (
            <button type="button" className={styles.secondary} disabled={busy || installActive} onClick={chooseDirectory}>
              {t("speech.chooseLocation")}
            </button>
          ) : null}
        </div>
        <p className={styles.hint}>{t("speech.locationHint")}</p>
      </section>
    </div>
  );
}
