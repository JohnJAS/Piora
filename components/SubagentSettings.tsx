"use client";

import { useEffect, useId, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { fetchModelCatalog, type ModelCatalogEntry } from "@/lib/model-catalog-client";
import {
  isSubagentProfileDisabled,
  resolveSubagentModelOverride,
  subagentProfilePreferenceKey,
  type SubagentProfile,
  type SubagentProfileWarning,
  type SubagentSettings as Settings,
} from "@/lib/subagent-types";
import { READONLY_SUBAGENT_TOOLS, SUBAGENT_PROFILE_TEMPLATES, type SubagentProfileTemplate } from "@/lib/subagents/profile-templates";
import { AliIcon } from "./AliIcon";
import { SubagentProfileEditor, type ProfileEditorSubmitPayload } from "./subagents/SubagentProfileEditor";
import styles from "./SettingsDialog.module.css";
import css from "./SubagentSettings.module.css";

const LIMIT_SPECS = [
  { key: "maxConcurrency", min: 1, max: 16 },
  { key: "timeoutSeconds", min: 0, max: 3600 },
  { key: "maxTokens", min: 0, max: 10_000_000 },
  { key: "maxResultChars", min: 1, max: 100_000 },
] as const;

const LIMIT_PRESETS = [
  { id: "conservative", maxConcurrency: 2, timeoutSeconds: 180, maxTokens: 0, maxResultChars: 6_000 },
  { id: "balanced", maxConcurrency: 4, timeoutSeconds: 0, maxTokens: 0, maxResultChars: 8_000 },
  { id: "high", maxConcurrency: 8, timeoutSeconds: 0, maxTokens: 0, maxResultChars: 16_000 },
] as const;

function isReadOnlyToolSet(tools?: string[]): boolean {
  if (!tools || tools.length === 0) return false;
  const readonlySet = new Set<string>(READONLY_SUBAGENT_TOOLS);
  return tools.every(tool => readonlySet.has(tool));
}

export function SubagentSettings({ cwd }: { cwd?: string }) {
  const { t, locale } = useI18n();
  const isZh = locale.toLowerCase().startsWith("zh");
  const descriptionId = useId();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profiles, setProfiles] = useState<SubagentProfile[]>([]);
  const [warnings, setWarnings] = useState<SubagentProfileWarning[]>([]);
  const [hasProjectScope, setHasProjectScope] = useState(Boolean(cwd));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState(false);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<{
    open: boolean;
    mode: "create" | "edit";
    profile?: SubagentProfile;
    template?: SubagentProfileTemplate;
  }>({ open: false, mode: "create" });
  const [editorError, setEditorError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setModels([]);
    setModelsLoading(true);
    setModelsError(false);
    void fetchModelCatalog({ cwd, signal: controller.signal, forceRefresh: catalogAttempt > 0 }).then(data => {
      if (!Array.isArray(data.modelList)) throw new Error("Invalid model catalog");
      if (!controller.signal.aborted) {
        setModels(data.modelList);
        setModelsError(!!data.modelError);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setModelsError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setModelsLoading(false);
    });
    return () => controller.abort();
  }, [cwd, catalogAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    void fetch(`/api/settings/subagents${query}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (controller.signal.aborted) return;
      setSettings(data.settings);
      setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setHasProjectScope(typeof data.hasProjectScope === "boolean" ? data.hasProjectScope : Boolean(cwd));
    }).catch(err => {
      if (!controller.signal.aborted) setError(String(err));
    });
    return () => controller.abort();
  }, [cwd]);

  async function save(next: Settings) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/settings/subagents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSettings(data.settings);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveProfile(payload: ProfileEditorSubmitPayload) {
    if (saving) return;
    setSaving(true);
    setEditorError("");
    setError("");
    try {
      const response = await fetch("/api/settings/subagents/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ...(cwd ? { cwd } : {}) }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save profile");
      if (Array.isArray(data.profiles)) setProfiles(data.profiles);
      if (Array.isArray(data.warnings)) setWarnings(data.warnings);
      if (data.settings) setSettings(data.settings);
      setEditorState({ open: false, mode: "create" });
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProfile(profile: SubagentProfile) {
    if (saving || profile.source === "built-in") return;
    if (typeof window !== "undefined" && !window.confirm(t("subagent.deleteConfirm", { name: profile.name }))) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/settings/subagents/profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profile.name, scope: profile.source, ...(cwd ? { cwd } : {}) }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to delete profile");
      if (Array.isArray(data.profiles)) setProfiles(data.profiles);
      if (Array.isArray(data.warnings)) setWarnings(data.warnings);
      if (data.settings) setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const enabledCount = settings
    ? profiles.filter(profile => !isSubagentProfileDisabled(settings, profile)).length
    : 0;
  const providers = [...new Set(models.map(model => model.provider))];

  const activePresetId = settings
    ? LIMIT_PRESETS.find(preset => (
      preset.maxConcurrency === settings.maxConcurrency
      && preset.timeoutSeconds === settings.timeoutSeconds
      && preset.maxTokens === settings.maxTokens
      && preset.maxResultChars === settings.maxResultChars
    ))?.id
    : undefined;

  return (
    <section className={`${styles.sectionCard} ${css.card}`} data-settings-id="laboratory.subagents">
      <div className={css.header}>
        <div className={css.headerLead}>
          <span className={css.headerIcon} data-enabled={settings?.enabled ?? false} aria-hidden="true">
            <AliIcon name="robot" size={18} />
          </span>
          <span className={css.headerCopy}>
            <span className={css.headerTitleRow}>
              <strong className={styles.rowTitle}>{t("subagent.title")}</strong>
              {settings && (
                <span className={css.statusPill} data-enabled={settings.enabled}>
                  <span className={css.statusPillDot} aria-hidden="true" />
                  <span>{t(settings.enabled ? "subagent.enabledBadge" : "subagent.disabledBadge")}</span>
                </span>
              )}
            </span>
            <span id={descriptionId} className={styles.rowDescription}>{t("subagent.description")}</span>
          </span>
        </div>
        <button
          type="button"
          role="switch"
          className={styles.switch}
          data-testid="subagent-toggle"
          aria-checked={settings?.enabled ?? false}
          aria-label={t("subagent.title")}
          aria-describedby={descriptionId}
          disabled={!settings || saving}
          onClick={() => { if (settings) void save({ ...settings, enabled: !settings.enabled }); }}
        >
          <span aria-hidden="true" />
        </button>
      </div>

      {settings && (
        <details className={css.options}>
          <summary className={css.summary}>
            <span>{t("subagent.options")}</span>
            <span className={css.summaryHint}>
              {profiles.length > 0
                ? t("subagent.optionsSummary", {
                  enabled: enabledCount,
                  total: profiles.length,
                  concurrency: settings.maxConcurrency,
                  timeout: settings.timeoutSeconds > 0 ? `${settings.timeoutSeconds}s` : t("subagent.unlimited"),
                })
                : t("subagent.optionsHint")}
            </span>
            <span className={css.chevron} aria-hidden="true" />
          </summary>

          <div className={css.body}>
            <section className={css.group} aria-labelledby={`${descriptionId}-profiles`}>
              <div className={css.groupHeader}>
                <div className={css.groupHeaderCopy}>
                  <h3 id={`${descriptionId}-profiles`} className={css.groupTitle}>{t("subagent.profilesTitle")}</h3>
                  <p className={css.hint}>{t("subagent.profilesHint")}</p>
                </div>
                <button
                  type="button"
                  className={css.primaryBtn}
                  data-testid="subagent-new-profile"
                  disabled={saving}
                  onClick={() => {
                    setEditorError("");
                    setEditorState({ open: true, mode: "create" });
                  }}
                >
                  <AliIcon name="plus" size={14} />
                  <span>{t("subagent.newProfile")}</span>
                </button>
              </div>

              <div className={css.templateBar}>
                <span className={css.templateLabel}>
                  <AliIcon name="sparkles" size={12} />
                  <span>{t("subagent.templatesLabel")}</span>
                </span>
                {SUBAGENT_PROFILE_TEMPLATES.map(template => (
                  <button
                    key={template.id}
                    type="button"
                    className={css.templateChip}
                    disabled={saving}
                    title={isZh ? template.descriptionZh : template.descriptionEn}
                    onClick={() => {
                      setEditorError("");
                      setEditorState({ open: true, mode: "create", template });
                    }}
                  >
                    <AliIcon name="plus" size={12} />
                    <span>{isZh ? template.titleZh : template.titleEn}</span>
                  </button>
                ))}
              </div>

              {warnings.length > 0 && (
                <div className={css.warningBanner} role="status">
                  <strong>{t("subagent.profileWarnings", { count: warnings.length })}</strong>
                  <ul>
                    {warnings.map((warning, index) => (
                      <li key={`${warning.scope}:${warning.file}:${index}`}>
                        [{t(`subagent.source.${warning.scope}`)}] {warning.file}: {warning.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(modelsLoading || modelsError || models.length === 0) && (
                <p className={css.catalogStatus} role="status">
                  <span>{t(modelsLoading ? "subagent.modelsLoading" : modelsError ? "subagent.modelsError" : "subagent.modelsEmpty")}</span>
                  {!modelsLoading && (
                    <button type="button" className={css.retry} onClick={() => setCatalogAttempt(attempt => attempt + 1)}>
                      {t("subagent.modelsRetry")}
                    </button>
                  )}
                </p>
              )}

              <div className={css.profiles}>
                {profiles.map(profile => {
                  const builtin = profile.source === "built-in" && (profile.name === "general-purpose" || profile.name === "Explore");
                  const title = builtin ? t(profile.name === "Explore" ? "subagent.exploreTitle" : "subagent.generalTitle") : profile.name;
                  const description = builtin ? t(profile.name === "Explore" ? "subagent.exploreDescription" : "subagent.generalDescription") : profile.description;
                  const prefKey = subagentProfilePreferenceKey(profile);
                  const enabled = !isSubagentProfileDisabled(settings, profile);
                  const modelValue = resolveSubagentModelOverride(settings, profile);
                  const modelLabel = (value: string) => {
                    const found = models.find(item => `${item.provider}/${item.id}` === value);
                    return found ? `${found.name || found.id} · ${found.provider}` : value;
                  };
                  const effectiveModel = modelValue || profile.model;
                  const unavailable = !modelsLoading && !!effectiveModel && !models.some(item => `${item.provider}/${item.id}` === effectiveModel);
                  const effectiveTools = profile.tools ?? (builtin && profile.name === "Explore" ? [...READONLY_SUBAGENT_TOOLS] : undefined);
                  const noTools = effectiveTools !== undefined && effectiveTools.length === 0;
                  const readonlyTools = isReadOnlyToolSet(effectiveTools);
                  const toolsBadge = effectiveTools === undefined
                    ? t("subagent.toolsAll")
                    : noTools
                      ? t("subagent.toolsNone")
                      : readonlyTools
                        ? t("subagent.toolsReadOnly", { count: effectiveTools.length })
                        : t("subagent.toolsCustom", { count: effectiveTools.length });
                  const showPrompt = expandedPrompt === `${profile.source}:${profile.id ?? profile.name}`;
                  const hasFooterActions = Boolean(profile.systemPrompt) || profile.source !== "built-in";

                  return (
                    <div className={css.profile} key={`${profile.source}:${profile.id ?? profile.name}`} data-subagent-profile={profile.name} data-enabled={enabled}>
                      <div className={css.profileTop}>
                        <label className={css.profileIdentity}>
                          <input
                            className={css.checkbox}
                            type="checkbox"
                            checked={enabled}
                            disabled={saving}
                            aria-label={t("subagent.enableProfile", { name: profile.name })}
                            onChange={event => void save({
                              ...settings,
                              disabledProfiles: event.target.checked
                                ? settings.disabledProfiles.filter(item => item !== prefKey)
                                : settings.disabledProfiles.includes(prefKey)
                                  ? settings.disabledProfiles
                                  : [...settings.disabledProfiles, prefKey],
                            })}
                          />
                          <span className={css.profileCopy}>
                            <span className={css.profileHeading}>
                              <strong>{title}</strong>
                              {builtin && <span className={css.profileCode}>{profile.name}</span>}
                              <span className={css.sourceBadge} data-source={profile.source}>
                                {t(`subagent.source.${profile.source}`)}
                              </span>
                            </span>
                            <span className={css.profileDescription}>{description}</span>
                          </span>
                        </label>
                      </div>

                      <div className={css.profileTags}>
                        <span className={css.capabilityTag}>
                          <AliIcon name={noTools ? "lock" : readonlyTools ? "eye" : "wrench"} size={12} />
                          <span>{toolsBadge}</span>
                        </span>
                        {profile.disallowedTools && profile.disallowedTools.length > 0 && (
                          <span className={css.capabilityTag} title={profile.disallowedTools.join(", ")}>
                            <span>{t("subagent.toolsDenied", { count: profile.disallowedTools.length })}</span>
                          </span>
                        )}
                        {profile.maxTurns ? (
                          <span className={css.capabilityTag}>
                            <AliIcon name="sync" size={12} />
                            <span>{t("subagent.maxTurnsBadge", { turns: profile.maxTurns })}</span>
                          </span>
                        ) : null}
                        {profile.background && (
                          <span className={css.capabilityTag}>{t("subagent.defaultBackground")}</span>
                        )}
                      </div>

                      <label className={css.modelField}>
                        <span className={css.modelLabel}>{t("subagent.profileModel")}</span>
                        <select
                          className={css.modelSelect}
                          aria-label={t("subagent.model", { name: profile.name })}
                          disabled={saving}
                          aria-busy={modelsLoading}
                          value={modelValue}
                          title={effectiveModel}
                          onChange={event => void save({
                            ...settings,
                            modelOverrides: { ...settings.modelOverrides, [prefKey]: event.target.value },
                          })}
                        >
                          <option value="">
                            {profile.model
                              ? t("subagent.profileDefaultModel", { model: modelLabel(profile.model) })
                              : t("subagent.inheritModel")}
                          </option>
                          {modelValue && !models.some(item => `${item.provider}/${item.id}` === modelValue) && (
                            <option value={modelValue} disabled>{modelValue}</option>
                          )}
                          {providers.map(provider => (
                            <optgroup key={provider} label={provider}>
                              {models.filter(item => item.provider === provider).map(item => (
                                <option key={item.id} value={`${provider}/${item.id}`}>
                                  {modelLabel(`${provider}/${item.id}`)}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {unavailable && <span className={css.modelWarning}>{t("subagent.modelUnavailable")}</span>}
                      </label>

                      {showPrompt && profile.systemPrompt && (
                        <pre className={css.promptPreview}>{profile.systemPrompt}</pre>
                      )}

                      {hasFooterActions && (
                        <div className={css.profileFooter}>
                          {profile.systemPrompt ? (
                            <button
                              type="button"
                              className={css.ghostBtn}
                              onClick={() => setExpandedPrompt(showPrompt ? null : `${profile.source}:${profile.id ?? profile.name}`)}
                            >
                              <AliIcon name={showPrompt ? "eye-close" : "eye"} size={12} />
                              <span>{t(showPrompt ? "subagent.hideInstructions" : "subagent.viewInstructions")}</span>
                            </button>
                          ) : <span />}

                          {profile.source !== "built-in" && (
                            <div className={css.profileFooterActions}>
                              <button
                                type="button"
                                className={css.ghostBtn}
                                disabled={saving}
                                onClick={() => {
                                  setEditorError("");
                                  setEditorState({ open: true, mode: "edit", profile });
                                }}
                              >
                                <AliIcon name="edit" size={12} />
                                <span>{t("subagent.editProfile")}</span>
                              </button>
                              <button
                                type="button"
                                className={`${css.ghostBtn} ${css.dangerBtn}`}
                                disabled={saving}
                                onClick={() => void handleDeleteProfile(profile)}
                              >
                                <AliIcon name="delete" size={12} />
                                <span>{t("subagent.deleteProfile")}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className={css.note}>{t("subagent.profileHelp")}</p>
            </section>

            <section className={css.group} aria-labelledby={`${descriptionId}-limits`}>
              <div className={css.limitsCard}>
                <h3 id={`${descriptionId}-limits`} className={css.groupTitle}>{t("subagent.limitsTitle")}</h3>
                <p className={css.hint}>{t("subagent.limitsHint")}</p>

                <div className={css.presetRow}>
                  {LIMIT_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      className={css.presetChip}
                      data-active={activePresetId === preset.id}
                      disabled={saving}
                      onClick={() => void save({
                        ...settings,
                        maxConcurrency: preset.maxConcurrency,
                        timeoutSeconds: preset.timeoutSeconds,
                        maxTokens: preset.maxTokens,
                        maxResultChars: preset.maxResultChars,
                      })}
                    >
                      {t(`subagent.preset.${preset.id}`)}
                    </button>
                  ))}
                  {activePresetId !== "balanced" && (
                    <button
                      type="button"
                      className={css.ghostBtn}
                      disabled={saving}
                      onClick={() => void save({
                        ...settings,
                        maxConcurrency: 4,
                        timeoutSeconds: 0,
                        maxTokens: 0,
                        maxResultChars: 8_000,
                      })}
                    >
                      {t("subagent.preset.reset")}
                    </button>
                  )}
                </div>

                <div className={css.fields}>
                  {LIMIT_SPECS.map(({ key, min, max }) => (
                    <label className={css.field} key={key}>
                      <span className={css.fieldLabelGroup}>
                        <span>{t(`subagent.${key}`)}</span>
                        <span className={css.fieldHint}>
                          {key === "maxTokens"
                            ? t("subagent.budgetUnlimitedHint")
                            : key === "timeoutSeconds"
                              ? t("subagent.timeoutUnlimitedHint")
                              : t("subagent.limitRange", { min, max: max.toLocaleString() })}
                        </span>
                      </span>
                      <input
                        type="number"
                        min={min}
                        max={max}
                        aria-label={t(`subagent.${key}`)}
                        disabled={saving}
                        defaultValue={settings[key]}
                        key={`${key}:${settings[key]}`}
                        onBlur={event => {
                          const value = Number(event.target.value);
                          if (value !== settings[key]) void save({ ...settings, [key]: value });
                        }}
                      />
                    </label>
                  ))}
                </div>
                <p className={css.note}>{t("subagent.budgetHelp")}</p>
              </div>
            </section>
          </div>
        </details>
      )}

      {error && <p className={css.error} role="alert">{error}</p>}

      <SubagentProfileEditor
        open={editorState.open}
        mode={editorState.mode}
        initialProfile={editorState.profile}
        initialTemplate={editorState.template}
        hasProjectScope={hasProjectScope}
        models={models}
        saving={saving}
        error={editorError}
        onClose={() => { if (!saving) setEditorState({ open: false, mode: "create" }); }}
        onSave={handleSaveProfile}
      />
    </section>
  );
}
