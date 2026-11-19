"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import styles from "./ModelRetrySettings.module.css";

async function readReserveInput(response: Response): Promise<string> {
  const data = await response.json() as { reserveTokens?: number; configuredReserveTokens?: number | null; error?: string };
  if (!response.ok || typeof data.reserveTokens !== "number") throw new Error(data.error ?? `HTTP ${response.status}`);
  return data.configuredReserveTokens === null ? "" : String(data.configuredReserveTokens ?? data.reserveTokens);
}

export function ModelCompactionSettings() {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [badInput, setBadInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/models-config/compaction", { cache: "no-store", signal: controller.signal })
      .then(readReserveInput)
      .then((reserve) => {
        setValue(reserve);
        setSaved(reserve);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setSaved("");
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => controller.abort();
  }, []);

  const numeric = value === "" ? null : Number(value);
  const valid = !badInput && (numeric === null || (Number.isInteger(numeric) && numeric >= 0 && numeric <= 131_072));
  const canSave = saved !== null && !busy && valid && value !== saved;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const response = await fetch("/api/models-config/compaction", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { reserveTokens: numeric } }),
      });
      const reserve = await readReserveInput(response);
      setValue(reserve);
      setSaved(reserve);
      setSuccess(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return <section className={styles.card} aria-labelledby="model-compaction-title">
    <div className={styles.heading}>
      <span className={styles.icon}><AliIcon name="timer" size={17} /></span>
      <div>
        <h3 id="model-compaction-title">{t("modelCompaction.title")}</h3>
        <p>{t("modelCompaction.description")}</p>
      </div>
    </div>
    <div className={styles.fields}>
      <label>
        <span>{t("modelCompaction.reserveTokens")}</span>
        <input
          type="number" min={0} max={131072} step={1} value={value}
          placeholder={t("modelCompaction.automatic")}
          disabled={busy || saved === null} aria-invalid={!valid}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setBadInput(event.currentTarget.validity.badInput);
            setSuccess(false);
            setError(null);
          }}
        />
        <small>{t("modelCompaction.reserveHint")}</small>
      </label>
    </div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {success ? <div className={styles.success} role="status">{t("modelCompaction.saved")}</div> : null}
    <div className={styles.footer}>
      <p><AliIcon name="info" size={13} />{t("modelCompaction.scope")}</p>
      <div className={styles.actions}><button type="button" className={styles.primary} disabled={!canSave} onClick={() => void save()}>{busy ? t("modelRetry.applying") : t("modelRetry.save")}</button></div>
    </div>
  </section>;
}
