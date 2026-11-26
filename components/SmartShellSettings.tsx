"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useNativeShellConfig } from "@/hooks/useNativeShellConfig";
import { shellRequest } from "@/lib/shell/client";
import type { NativeShellSettings } from "@/lib/shell/types";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
} from "./settings/SettingsPrimitives";
import primitiveStyles from "./settings/SettingsPrimitives.module.css";
import styles from "./workspace/SmartShell.module.css";

const TIMEOUT_PRESETS = [
  { id: "5m", minutes: 5 },
  { id: "15m", minutes: 15 },
  { id: "30m", minutes: 30 },
  { id: "60m", minutes: 60 },
] as const;

type TimeoutPresetId = typeof TIMEOUT_PRESETS[number]["id"] | "custom";

export function SmartShellSettings({ cwd }: { cwd?: string }) {
  const { t } = useI18n();
  const [timeoutMinutes, setTimeoutMinutes] = useState<string | null>(null);
  const [savedMinutes, setSavedMinutes] = useState<string | null>(null);
  const [customTimeoutOpen, setCustomTimeoutOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { config, error: profileLoadError } = useNativeShellConfig();
  const [shellDraft, setShellDraft] = useState<string | null>(null);
  const [shellSaving, setShellSaving] = useState(false);
  const [shellError, setShellError] = useState("");
  const [shellSaved, setShellSaved] = useState(false);
  const selectedShell = shellDraft ?? config?.executable ?? "";

  const saveDefaultShell = async (executable: string) => {
    setShellSaving(true); setShellError(""); setShellSaved(false);
    try {
      await shellRequest<NativeShellSettings>("native-settings", { executable: executable || null });
      setShellSaved(true);
      window.dispatchEvent(new Event("piora-native-shell-settings"));
    } catch (cause) { setShellError(String(cause)); }
    finally { setShellSaving(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/shell-timeout", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const settings = await response.json() as { timeoutSeconds: number };
        const minutes = String(settings.timeoutSeconds / 60);
        setTimeoutMinutes(minutes);
        setSavedMinutes(minutes);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : String(loadError));
      });
    return () => controller.abort();
  }, []);

  const persistTimeoutSeconds = async (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 2_147_483) {
      setError(t("shell.agentTimeoutInvalid"));
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/shell-timeout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeoutSeconds: seconds }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const settings = await response.json() as { timeoutSeconds: number };
      const minutes = String(settings.timeoutSeconds / 60);
      setTimeoutMinutes(minutes);
      setSavedMinutes(minutes);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const saveTimeout = async () => {
    if (!timeoutMinutes?.trim()) {
      setError(t("shell.agentTimeoutInvalid"));
      return;
    }
    await persistTimeoutSeconds(Math.round(Number(timeoutMinutes) * 60));
  };

  const matchedPreset = TIMEOUT_PRESETS.find((preset) => String(preset.minutes) === timeoutMinutes);
  const activeTimeoutPreset: TimeoutPresetId = customTimeoutOpen ? "custom" : (matchedPreset?.id ?? "custom");

  return (
    <SettingsPage title={t("shell.title")} description={t("shell.description")}>
      <SettingsSection>
        <SettingsRow
          title={t("shell.defaultShell")}
          description={
            <>
              {t("shell.nativeProfileHint")}
              {shellSaved ? <div className={primitiveStyles.statusText} role="status">{t("shell.defaultShellSaved")}</div> : null}
              {shellError || profileLoadError ? <div className={primitiveStyles.statusError} role="alert">{shellError || profileLoadError}</div> : null}
              {cwd ? <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: "calc(var(--text-xs) * 0.92)" }}>{cwd}</div> : null}
            </>
          }
          settingsId="shell.defaultShell"
        >
          <select
            className={primitiveStyles.select}
            aria-label={t("shell.defaultShell")}
            value={selectedShell}
            disabled={!config || shellSaving}
            onChange={(event) => {
              const next = event.target.value;
              setShellDraft(next);
              void saveDefaultShell(next);
            }}
          >
            <option value="">{t("shell.detectShell")}</option>
            {config?.executable && !config.profiles.some(profile => profile.executable === config.executable)
              ? <option value={config.executable}>{config.executable}</option> : null}
            {config?.profiles.map(profile => <option key={profile.executable} value={profile.executable}>{profile.label}{profile.bundled ? ` (${t("shell.bundled")})` : ""}</option>)}
          </select>
        </SettingsRow>

        <div data-settings-id="shell.agentTimeout">
          <SettingsRow
            title={t("shell.agentTimeoutTitle")}
            description={
              <>
                {t("shell.agentTimeoutDescription")}
                {saved ? <div className={primitiveStyles.statusText} role="status">{t("shell.agentTimeoutSaved")}</div> : null}
                {error ? <div className={primitiveStyles.statusError} role="alert">{error}</div> : null}
              </>
            }
          >
            <SettingsSegmented
              value={activeTimeoutPreset}
              disabled={timeoutMinutes === null || saving}
              ariaLabel={t("shell.agentTimeoutTitle")}
              options={[
                ...TIMEOUT_PRESETS.map((preset) => ({ value: preset.id, label: t(`shell.timeoutPreset.${preset.id}`) })),
                { value: "custom" as const, label: t("shell.timeoutPreset.custom") },
              ]}
              onChange={(next) => {
                if (next === "custom") {
                  setCustomTimeoutOpen(true);
                  return;
                }
                setCustomTimeoutOpen(false);
                const preset = TIMEOUT_PRESETS.find((item) => item.id === next);
                if (!preset) return;
                setTimeoutMinutes(String(preset.minutes));
                void persistTimeoutSeconds(preset.minutes * 60);
              }}
            />
          </SettingsRow>
          {activeTimeoutPreset === "custom" ? (
            <div style={{ padding: "0 16px 14px", display: "flex", alignItems: "flex-end", gap: 10 }}>
              <label className={styles.timeoutField} style={{ flex: 1 }}>
                <span>{t("shell.agentTimeoutMinutes")}</span>
                <input
                  type="number"
                  min={1 / 60}
                  max={2_147_483 / 60}
                  step="any"
                  value={timeoutMinutes ?? ""}
                  disabled={timeoutMinutes === null || saving}
                  onChange={(event) => { setTimeoutMinutes(event.target.value); setError(null); setSaved(false); }}
                />
              </label>
              <button
                type="button"
                className={primitiveStyles.buttonPrimary}
                disabled={timeoutMinutes === null || saving || timeoutMinutes === savedMinutes}
                onClick={() => void saveTimeout()}
              >
                {saving ? t("shell.agentTimeoutSaving") : t("shell.save")}
              </button>
            </div>
          ) : null}
        </div>

        <SettingsRow
          title={t("shell.history")}
          description={t("shell.nativeHistoryHint")}
          settingsId="shell.history"
        />
      </SettingsSection>
    </SettingsPage>
  );
}
