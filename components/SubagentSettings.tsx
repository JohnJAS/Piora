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
  return <section className={`${styles.sectionCard} ${css.card}`} data-settings-id="laboratory.subagents">
    <div className={css.header}>
      <span className={css.headerCopy}><strong className={styles.rowTitle}>{t("subagent.title")}</strong>
        <span id={descriptionId} className={styles.rowDescription}>{t("subagent.description")}</span></span>
      <button type="button" role="switch" className={styles.switch} data-testid="subagent-toggle"
        aria-checked={settings?.enabled ?? false} aria-label={t("subagent.title")} aria-describedby={descriptionId}
        disabled={!settings || saving} onClick={() => { if (settings) void save({ ...settings, enabled: !settings.enabled }); }}><span aria-hidden="true" /></button>
    </div>
    {settings && <details className={css.options}>
      <summary className={css.summary}>
        <span>{t("subagent.options")}</span>
        <span className={css.summaryHint}>{t("subagent.optionsHint")}</span>
        <span className={css.chevron} aria-hidden="true" />
      </summary>
      <div className={css.body}>
        <section className={css.group} aria-labelledby={`${descriptionId}-profiles`}>
          <h3 id={`${descriptionId}-profiles`} className={css.groupTitle}>{t("subagent.profilesTitle")}</h3>
          <p className={css.hint}>{t("subagent.profilesHint")}</p>
          <div className={css.profiles}>
            {profiles.map(profile => {
              const builtin = profile.source === "built-in" && (profile.name === "general-purpose" || profile.name === "Explore");
              const title = builtin ? t(profile.name === "Explore" ? "subagent.exploreTitle" : "subagent.generalTitle") : profile.name;
              const description = builtin ? t(profile.name === "Explore" ? "subagent.exploreDescription" : "subagent.generalDescription") : profile.description;
              const enabled = !settings.disabledProfiles.includes(profile.name);
              return <div className={css.profile} key={profile.name} data-subagent-profile={profile.name} data-enabled={enabled}>
                <label className={css.profileIdentity}>
                  <input className={css.checkbox} type="checkbox" checked={enabled} disabled={saving}
                    aria-label={t("subagent.enableProfile", { name: profile.name })}
                    onChange={event => void save({ ...settings, disabledProfiles: event.target.checked ? settings.disabledProfiles.filter(name => name !== profile.name) : [...settings.disabledProfiles, profile.name] })} />
                  <span className={css.profileCopy}>
                    <span className={css.profileHeading}><strong>{title}</strong>{builtin && <span className={css.profileCode}>{profile.name}</span>}</span>
                    <span className={css.profileDescription}>{description}</span>
                  </span>
                </label>
                <label className={css.modelField}>
                  <span className={css.modelLabel}><span>{t("subagent.profileModel")}</span><span className={css.modelFormat}>provider/modelId</span></span>
                  <input className={css.modelInput} aria-label={t("subagent.model", { name: profile.name })} placeholder={t("subagent.inheritModel")} disabled={saving}
                    defaultValue={settings.modelOverrides[profile.name] ?? ""} key={`${profile.name}:${settings.modelOverrides[profile.name] ?? ""}`}
                    onBlur={event => { const value = event.target.value.trim(); if (value !== (settings.modelOverrides[profile.name] ?? "")) void save({ ...settings, modelOverrides: { ...settings.modelOverrides, [profile.name]: value } }); }} />
                </label>
              </div>;
            })}
          </div>
          <p className={css.note}>{t("subagent.profileHelp")}</p>
        </section>
        <section className={css.group} aria-labelledby={`${descriptionId}-limits`}>
          <h3 id={`${descriptionId}-limits`} className={css.groupTitle}>{t("subagent.limitsTitle")}</h3>
          <p className={css.hint}>{t("subagent.limitsHint")}</p>
          <div className={css.fields}>
            {(["maxConcurrency", "timeoutSeconds", "maxTokens", "maxResultChars"] as const).map(key => <label className={css.field} key={key}>
              <span>{t(`subagent.${key}`)}</span><input type="number" min={1} aria-label={t(`subagent.${key}`)} disabled={saving}
                defaultValue={settings[key]} key={`${key}:${settings[key]}`} onBlur={event => { const value = Number(event.target.value); if (value !== settings[key]) void save({ ...settings, [key]: value }); }} />
            </label>)}
          </div>
          <p className={css.note}>{t("subagent.budgetHelp")}</p>
        </section>
      </div>
    </details>}
    {error && <p className={css.error} role="alert">{error}</p>}
  </section>;
}
