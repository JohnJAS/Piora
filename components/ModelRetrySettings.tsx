"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import { SettingsRow, SettingsSegmented, SettingsSwitch } from "./settings/SettingsPrimitives";
import primitiveStyles from "./settings/SettingsPrimitives.module.css";
import styles from "./ModelRetrySettings.module.css";
import settingsStyles from "./SettingsDialog.module.css";

interface LoadedSettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  provider: { timeoutMs: number | null; maxRetries: number | null; maxRetryDelayMs: number };
  httpIdleTimeoutMs: number;
}

interface Draft {
  enabled: boolean;
  maxRetries: string;
  baseDelayMs: string;
  providerTimeout: string;
  providerRetries: string;
  providerDelay: string;
  idleTimeout: string;
}

function secondsOf(ms: number | null): string {
  if (ms === null) return "";
  if (ms === 0) return "0";
  return String(Math.max(1, Math.round(ms / 1000)));
}

function toDraft(settings: LoadedSettings): Draft {
  return {
    enabled: settings.enabled,
    maxRetries: String(settings.maxRetries),
    baseDelayMs: String(settings.baseDelayMs),
    providerTimeout: secondsOf(settings.provider.timeoutMs),
    providerRetries: settings.provider.maxRetries === null ? "" : String(settings.provider.maxRetries),
    providerDelay: secondsOf(settings.provider.maxRetryDelayMs),
    idleTimeout: secondsOf(settings.httpIdleTimeoutMs),
  };
}

function toPayload(draft: Draft): { settings: LoadedSettings } {
  const secondsToMs = (raw: string): number | null => (raw.trim() === "" ? null : Math.round(Number(raw.trim()) * 1000));
  const nullableInt = (raw: string): number | null => (raw.trim() === "" ? null : Number(raw.trim()));
  return {
    settings: {
      enabled: draft.enabled,
      maxRetries: Number(draft.maxRetries.trim()),
      baseDelayMs: Number(draft.baseDelayMs.trim()),
      provider: {
        timeoutMs: secondsToMs(draft.providerTimeout),
        maxRetries: nullableInt(draft.providerRetries),
        maxRetryDelayMs: secondsToMs(draft.providerDelay) ?? 0,
      },
      httpIdleTimeoutMs: secondsToMs(draft.idleTimeout) ?? 0,
    },
  };
}

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  return typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
}

export function ModelRetrySettings({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/models-config/retry", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        setDraft(toDraft(await response.json() as LoadedSettings));
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => controller.abort();
  }, []);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
    setError(null);
    setResult(null);
  }, []);

  const persist = useCallback(async (targetDraft: Draft) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/models-config/retry", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toPayload(targetDraft)),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setDraft(toDraft(await response.json() as LoadedSettings));
      setDirty(false);
      setResult(t("modelRetry.saved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const save = useCallback(async () => {
    if (!draft) return;
    await persist(draft);
  }, [draft, persist]);

  if (compact) {
    type PresetKey = "standard" | "resilient" | "off";
    const PRESETS: Record<PresetKey, Draft> = {
      standard: { enabled: true, maxRetries: "3", baseDelayMs: "1500", providerTimeout: "", idleTimeout: "120", providerRetries: "", providerDelay: "" },
      resilient: { enabled: true, maxRetries: "6", baseDelayMs: "2000", providerTimeout: "180", idleTimeout: "180", providerRetries: "2", providerDelay: "15" },
      off: { enabled: false, maxRetries: "0", baseDelayMs: "1000", providerTimeout: "", idleTimeout: "120", providerRetries: "0", providerDelay: "0" },
    };
    const activePreset: PresetKey | "" = draft
      ? (["standard", "resilient", "off"] as const).find((key) => {
        const p = PRESETS[key];
        return p.enabled === draft.enabled && p.maxRetries === draft.maxRetries && p.baseDelayMs === draft.baseDelayMs
          && p.providerTimeout === draft.providerTimeout && p.idleTimeout === draft.idleTimeout;
      }) ?? ""
      : "";
    return (
      <div style={{ display: "grid", gap: 14 }} aria-labelledby="model-retry-title">
        <div className={primitiveStyles.compactFooter}>
          <div>
            <div id="model-retry-title" className={primitiveStyles.rowTitle}>{t("modelRetry.title")}</div>
            <div className={primitiveStyles.rowDescription}>{t("modelRetry.description")}</div>
          </div>
          <SettingsSegmented
            value={activePreset}
            disabled={!draft || busy}
            ariaLabel={t("modelRetry.title")}
            options={[
              { value: "standard", label: t("modelRetry.preset.standard") },
              { value: "resilient", label: t("modelRetry.preset.resilient") },
              { value: "off", label: t("modelRetry.preset.off") },
            ]}
            onChange={(next) => {
              if (!next) return;
              const nextDraft = PRESETS[next];
              setDraft(nextDraft);
              void persist(nextDraft);
            }}
          />
        </div>
        {draft ? (
          <>
            <SettingsRow title={t("modelRetry.enabled")} titleId="model-retry-enabled-label">
              <SettingsSwitch
                checked={draft.enabled}
                disabled={busy}
                label={t("modelRetry.enabled")}
                onToggle={() => update({ enabled: !draft.enabled })}
              />
            </SettingsRow>
            <div className={primitiveStyles.gridTwo}>
              <label className={primitiveStyles.field}>
                <span className={primitiveStyles.fieldLabel}>{t("modelRetry.maxRetries")}</span>
                <input className={primitiveStyles.input} type="number" min={0} max={10} value={draft.maxRetries} disabled={busy} onChange={(event) => update({ maxRetries: event.target.value })} />
              </label>
              <label className={primitiveStyles.field}>
                <span className={primitiveStyles.fieldLabel}>{t("modelRetry.baseDelayMs")}</span>
                <input className={primitiveStyles.input} type="number" min={100} max={60000} value={draft.baseDelayMs} disabled={busy} onChange={(event) => update({ baseDelayMs: event.target.value })} />
              </label>
              <label className={primitiveStyles.field}>
                <span className={primitiveStyles.fieldLabel}>{t("modelRetry.providerTimeout")}</span>
                <input className={primitiveStyles.input} type="number" min={1} max={3600} step={1} value={draft.providerTimeout} disabled={busy} onChange={(event) => update({ providerTimeout: event.target.value })} />
                <span className={primitiveStyles.fieldHint}>{t("modelRetry.providerTimeoutHint")}</span>
              </label>
              <label className={primitiveStyles.field}>
                <span className={primitiveStyles.fieldLabel}>{t("modelRetry.idleTimeout")}</span>
                <input className={primitiveStyles.input} type="number" min={0} max={3600} step={1} value={draft.idleTimeout} disabled={busy} onChange={(event) => update({ idleTimeout: event.target.value })} />
                <span className={primitiveStyles.fieldHint}>{t("modelRetry.idleTimeoutHint")}</span>
              </label>
              <label className={primitiveStyles.field}>
                <span className={primitiveStyles.fieldLabel}>{t("modelRetry.providerRetries")}</span>
                <input className={primitiveStyles.input} type="number" min={0} max={5} value={draft.providerRetries} disabled={busy} onChange={(event) => update({ providerRetries: event.target.value })} />
              </label>
              <label className={primitiveStyles.field}>
                <span className={primitiveStyles.fieldLabel}>{t("modelRetry.providerDelay")}</span>
                <input className={primitiveStyles.input} type="number" min={0} max={300} step={1} value={draft.providerDelay} disabled={busy} onChange={(event) => update({ providerDelay: event.target.value })} />
              </label>
            </div>
            <div className={primitiveStyles.compactFooter}>
              <div>
                {error ? <span className={primitiveStyles.statusError} role="alert">{error}</span> : null}
                {result ? <span className={primitiveStyles.statusText} role="status">{result}</span> : null}
              </div>
              <button type="button" className={primitiveStyles.buttonPrimary} disabled={!draft || busy || !dirty} onClick={() => void save()}>
                {busy ? t("modelRetry.applying") : t("modelRetry.save")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="model-retry-title">
      <div className={styles.heading}>
        <span className={styles.icon}><AliIcon name="timer" size={17} /></span>
        <div>
          <h3 id="model-retry-title">{t("modelRetry.title")}</h3>
          <p>{t("modelRetry.description")}</p>
        </div>
      </div>

      {draft ? (
        <div className={styles.fields}>
          <div className={styles.toggle}>
            <span id="model-retry-enabled-label">{t("modelRetry.enabled")}</span>
            <button
              type="button"
              className={settingsStyles.switch}
              role="switch"
              aria-checked={draft.enabled}
              aria-labelledby="model-retry-enabled-label"
              disabled={busy}
              onClick={() => update({ enabled: !draft.enabled })}
            >
              <span />
            </button>
          </div>
          <label>
            <span>{t("modelRetry.maxRetries")}</span>
            <input type="number" min={0} max={10} value={draft.maxRetries} disabled={busy} onChange={(event) => update({ maxRetries: event.target.value })} />
          </label>
          <label>
            <span>{t("modelRetry.baseDelayMs")}</span>
            <input type="number" min={100} max={60000} value={draft.baseDelayMs} disabled={busy} onChange={(event) => update({ baseDelayMs: event.target.value })} />
          </label>
          <label>
            <span>{t("modelRetry.providerTimeout")}</span>
            <input type="number" min={1} max={3600} step={1} value={draft.providerTimeout} disabled={busy} onChange={(event) => update({ providerTimeout: event.target.value })} />
            <small>{t("modelRetry.providerTimeoutHint")}</small>
          </label>
          <label>
            <span>{t("modelRetry.idleTimeout")}</span>
            <input type="number" min={0} max={3600} step={1} value={draft.idleTimeout} disabled={busy} onChange={(event) => update({ idleTimeout: event.target.value })} />
            <small>{t("modelRetry.idleTimeoutHint")}</small>
          </label>
          <label>
            <span>{t("modelRetry.providerRetries")}</span>
            <input type="number" min={0} max={5} value={draft.providerRetries} disabled={busy} onChange={(event) => update({ providerRetries: event.target.value })} />
            <small>{t("modelRetry.providerRetriesHint")}</small>
          </label>
          <label>
            <span>{t("modelRetry.providerDelay")}</span>
            <input type="number" min={0} max={300} step={1} value={draft.providerDelay} disabled={busy} onChange={(event) => update({ providerDelay: event.target.value })} />
          </label>
        </div>
      ) : null}

      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      {result ? <div className={styles.success} role="status">{result}</div> : null}

      <div className={styles.footer}>
        <p><AliIcon name="info" size={13} />{t("modelRetry.scope")}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!draft || busy || !dirty} onClick={() => void save()}>
            {busy ? t("modelRetry.applying") : t("modelRetry.save")}
          </button>
        </div>
      </div>
    </section>
  );
}
