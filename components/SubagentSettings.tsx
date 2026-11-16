"use client";

import { useEffect, useId, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SubagentProfile, SubagentSettings as Settings } from "@/lib/subagent-types";
import styles from "./SettingsDialog.module.css";
import css from "./SubagentSettings.module.css";

export function SubagentSettings({ cwd }: { cwd?: string }) {
  const { t } = useI18n(), descriptionId = useId();
  const [settings, setSettings] = useState<Settings | null>(null), [profiles, setProfiles] = useState<SubagentProfile[]>([]);
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    void fetch(`/api/settings/subagents${query}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setSettings(data.settings); setProfiles(data.profiles);
    }).catch(error => { if (!controller.signal.aborted) setError(String(error)); });
    return () => controller.abort();
  }, [cwd]);
  async function save(next: Settings) {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/settings/subagents", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next), signal: AbortSignal.timeout(20_000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setSettings(data.settings);
    } catch (error) { setError(String(error)); } finally { setSaving(false); }
  }
  return <section className={styles.sectionCard} data-settings-id="laboratory.subagents">
    <div className={styles.conversationRow}>
      <span className={styles.conversationCopy}><strong className={styles.rowTitle}>{t("subagent.title")}</strong>
        <span id={descriptionId} className={styles.rowDescription}>{t("subagent.description")}</span></span>
      <button type="button" role="switch" className={styles.switch} data-testid="subagent-toggle"
        aria-checked={settings?.enabled ?? false} aria-label={t("subagent.title")} aria-describedby={descriptionId}
        disabled={!settings || saving} onClick={() => { if (settings) void save({ ...settings, enabled: !settings.enabled }); }}><span aria-hidden="true" /></button>
    </div>
    {settings && <details className={css.options}>
      <summary>{t("subagent.options")}</summary>
      <div className={css.fields}>
        {(["maxConcurrency", "timeoutSeconds", "maxTokens", "maxResultChars"] as const).map(key => <label key={key}>
          <span>{t(`subagent.${key}`)}</span><input type="number" min={1} aria-label={t(`subagent.${key}`)} disabled={saving}
            defaultValue={settings[key]} key={`${key}:${settings[key]}`} onBlur={event => { const value = Number(event.target.value); if (value !== settings[key]) void save({ ...settings, [key]: value }); }} />
        </label>)}
      </div>
      <p className={styles.localNote}>{t("subagent.budgetHelp")}</p>
      {profiles.map(profile => <div className={css.profile} key={profile.name}>
        <label><input type="checkbox" checked={!settings.disabledProfiles.includes(profile.name)} disabled={saving} onChange={event => void save({ ...settings, disabledProfiles: event.target.checked ? settings.disabledProfiles.filter(name => name !== profile.name) : [...settings.disabledProfiles, profile.name] })} /> {profile.name}</label>
        <input aria-label={t("subagent.model", { name: profile.name })} placeholder={t("subagent.inheritModel")} disabled={saving}
          defaultValue={settings.modelOverrides[profile.name] ?? ""} key={`${profile.name}:${settings.modelOverrides[profile.name] ?? ""}`}
          onBlur={event => { const value = event.target.value.trim(); if (value !== (settings.modelOverrides[profile.name] ?? "")) void save({ ...settings, modelOverrides: { ...settings.modelOverrides, [profile.name]: value } }); }} />
      </div>)}
      <p className={styles.localNote}>{t("subagent.profileHelp")}</p>
    </details>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
