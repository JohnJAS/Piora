"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import { SettingsSegmented } from "./settings/SettingsPrimitives";
import primitiveStyles from "./settings/SettingsPrimitives.module.css";
import styles from "./ModelRetrySettings.module.css";

async function readReserveInput(response: Response): Promise<string> {
  const data = await response.json() as { reserveTokens?: number; configuredReserveTokens?: number | null; error?: string };
  if (!response.ok || typeof data.reserveTokens !== "number") throw new Error(data.error ?? `HTTP ${response.status}`);
  return data.configuredReserveTokens === null ? "" : String(data.configuredReserveTokens ?? data.reserveTokens);
}

export function ModelCompactionSettings({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [badInput, setBadInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

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

  const persistReserve = async (reserveTokens: number | null) => {
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const response = await fetch("/api/models-config/compaction", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { reserveTokens } }),
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

  const save = async () => {
    if (!canSave) return;
    await persistReserve(numeric);
  };

  if (compact) {
    type PresetKey = "auto" | "compact" | "generous" | "off" | "custom";
    const PRESET_VALUES: Record<Exclude<PresetKey, "custom">, { raw: string; numeric: number | null }> = {
      auto: { raw: "", numeric: null },
      compact: { raw: "32000", numeric: 32000 },
      generous: { raw: "8192", numeric: 8192 },
      off: { raw: "0", numeric: 0 },
    };
    const matchedPreset = (Object.keys(PRESET_VALUES) as Exclude<PresetKey, "custom">[]).find(
      (k) => PRESET_VALUES[k].raw === value,
    );
    const activePreset: PresetKey = customOpen ? "custom" : (matchedPreset ?? "custom");
    return (
      <div style={{ display: "grid", gap: 12 }} data-settings-id="models.compaction" aria-labelledby="model-compaction-title">
        <div className={primitiveStyles.compactFooter}>
          <div>
            <div id="model-compaction-title" className={primitiveStyles.rowTitle}>{t("modelCompaction.title")}</div>
            <div className={primitiveStyles.rowDescription}>{t("modelCompaction.description")}</div>
          </div>
          <SettingsSegmented
            value={activePreset}
            disabled={busy || saved === null}
            ariaLabel={t("modelCompaction.title")}
            options={[
              { value: "auto", label: t("modelCompaction.preset.auto") },
              { value: "compact", label: t("modelCompaction.preset.compact") },
              { value: "generous", label: t("modelCompaction.preset.generous") },
              { value: "off", label: t("modelCompaction.preset.off") },
              { value: "custom", label: t("modelCompaction.preset.custom") },
            ]}
            onChange={(next) => {
              if (next === "custom") {
                setCustomOpen(true);
                return;
              }
              setCustomOpen(false);
              setBadInput(false);
              const preset = PRESET_VALUES[next];
              setValue(preset.raw);
              if (saved !== null && preset.raw !== saved) void persistReserve(preset.numeric);
            }}
          />
        </div>
        {activePreset === "custom" ? (
          <div className={primitiveStyles.compactFooter}>
            <label className={primitiveStyles.field} style={{ flex: 1 }}>
              <span className={primitiveStyles.fieldLabel}>{t("modelCompaction.reserveTokens")}</span>
              <input
                className={primitiveStyles.input}
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
            </label>
            <button type="button" className={primitiveStyles.buttonPrimary} disabled={!canSave} onClick={() => void save()}>
              {busy ? t("modelRetry.applying") : t("modelRetry.save")}
            </button>
          </div>
        ) : null}
        {error ? <div className={primitiveStyles.statusError} role="alert">{error}</div> : null}
        {success ? <div className={primitiveStyles.statusText} role="status">{t("modelCompaction.saved")}</div> : null}
      </div>
    );
  }

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
