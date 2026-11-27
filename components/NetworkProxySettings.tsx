"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { NetworkProxyMode, NetworkProxySettings } from "@/lib/network-proxy";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
} from "./settings/SettingsPrimitives";
import primitiveStyles from "./settings/SettingsPrimitives.module.css";
import styles from "./NetworkProxySettings.module.css";

const DEFAULT_DRAFT: NetworkProxySettings = {
  mode: "system",
  proxyUrl: "",
  bypass: "localhost,127.0.0.1,::1",
};

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  return typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`;
}

export function NetworkProxySettings() {
  const { t } = useI18n();
  const [draft, setDraft] = useState<NetworkProxySettings>(DEFAULT_DRAFT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/network-proxy", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        const settings = await response.json() as NetworkProxySettings;
        setDraft(settings);
        await window.piDesktop?.setNetworkProxy?.(settings);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const update = useCallback((patch: Partial<NetworkProxySettings>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
    setError(null);
    setResult(null);
  }, []);

  const saveAndApply = useCallback(async (nextDraft: NetworkProxySettings = draft): Promise<NetworkProxySettings> => {
    const response = await fetch("/api/network-proxy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nextDraft),
    });
    if (!response.ok) throw new Error(await responseError(response));
    const settings = await response.json() as NetworkProxySettings;
    const desktopApplied = await window.piDesktop?.setNetworkProxy?.(settings);
    if (desktopApplied === false) throw new Error(t("networkProxy.desktopApplyFailed"));
    setDraft(settings);
    setDirty(false);
    return settings;
  }, [draft, t]);

  const run = useCallback(async (action: "save" | "test", nextDraft?: NetworkProxySettings) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      await saveAndApply(nextDraft);
      if (action === "save") {
        setResult(t("networkProxy.saved"));
        return;
      }
      const response = await fetch("/api/network-proxy", { method: "POST" });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json() as { latencyMs?: number };
      setResult(t("networkProxy.testSucceeded", { latency: payload.latencyMs ?? 0 }));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setBusy(false);
    }
  }, [saveAndApply, t]);

  const modes: NetworkProxyMode[] = ["system", "manual", "direct"];

  return (
    <SettingsPage
      title={t("networkProxy.title")}
      actions={
        <button type="button" className={primitiveStyles.button} disabled={loading || busy} onClick={() => void run("test")}>
          {busy ? t("networkProxy.applying") : t("networkProxy.test")}
        </button>
      }
    >
      <SettingsSection>
        <SettingsRow
          title={t("networkProxy.mode")}
          description={t(`networkProxy.mode.${draft.mode}Description`)}
        >
          <SettingsSegmented
            value={draft.mode}
            disabled={loading || busy}
            ariaLabel={t("networkProxy.mode")}
            options={modes.map((mode) => ({ value: mode, label: t(`networkProxy.mode.${mode}`) }))}
            onChange={(mode) => {
              const next = { ...draft, mode };
              setDraft(next);
              setDirty(true);
              setError(null);
              setResult(null);
              if (mode !== "manual") {
                void run("save", next);
              }
            }}
          />
        </SettingsRow>

        {draft.mode === "manual" ? (
          <div style={{ padding: "14px 16px 16px", display: "grid", gap: 12 }}>
            <div className={styles.fields} style={{ marginTop: 0 }}>
              <label>
                <span>{t("networkProxy.address")}</span>
                <input
                  type="url"
                  value={draft.proxyUrl}
                  disabled={loading || busy}
                  placeholder="http://127.0.0.1:7890"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => update({ proxyUrl: event.target.value })}
                />
              </label>
              <label>
                <span>{t("networkProxy.bypass")}</span>
                <input
                  type="text"
                  value={draft.bypass}
                  disabled={loading || busy}
                  placeholder="localhost,127.0.0.1,*.company.local"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => update({ bypass: event.target.value })}
                />
                <small>{t("networkProxy.bypassHint")}</small>
              </label>
            </div>
            <div className={primitiveStyles.compactFooter}>
              <span />
              <button type="button" className={primitiveStyles.buttonPrimary} disabled={loading || busy || !dirty} onClick={() => void run("save")}>
                {busy ? t("networkProxy.applying") : t("networkProxy.save")}
              </button>
            </div>
          </div>
        ) : null}

        {error ? <div style={{ padding: "10px 16px" }} className={primitiveStyles.statusError} role="alert">{error}</div> : null}
        {result ? <div style={{ padding: "10px 16px" }} className={primitiveStyles.statusText} role="status">{result}</div> : null}
      </SettingsSection>
    </SettingsPage>
  );
}
