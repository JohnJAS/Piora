"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  createCliAlignedPresetSettings,
  createDefaultRuntimePromptSettings,
  RUNTIME_PROMPT_EXTENSION_KEYS,
  type RuntimePromptExtensionKey,
  type RuntimePromptSettings,
  type RuntimePromptSettingsPatch,
} from "@/lib/prompt-runtime/types";
import { ModelErrorText } from "./ModelErrorText";
import { SettingsDisclosure, SettingsRow, SettingsSection, SettingsSwitch } from "./settings/SettingsPrimitives";
import primitiveStyles from "./settings/SettingsPrimitives.module.css";
import dialogStyles from "./SettingsDialog.module.css";
import styles from "./RuntimePromptSettings.module.css";

function mergeSettings(base: RuntimePromptSettings, data: Partial<RuntimePromptSettings>): RuntimePromptSettings {
  const next: RuntimePromptSettings = {
    version: 1,
    mergeCompact: typeof data.mergeCompact === "boolean" ? data.mergeCompact : base.mergeCompact,
    alignCliCompaction: typeof data.alignCliCompaction === "boolean" ? data.alignCliCompaction : base.alignCliCompaction,
    extensions: { ...base.extensions },
  };
  if (data.extensions && typeof data.extensions === "object") {
    for (const key of RUNTIME_PROMPT_EXTENSION_KEYS) {
      if (typeof data.extensions[key] === "boolean") {
        next.extensions[key] = data.extensions[key];
      }
    }
  }
  return next;
}

export function RuntimePromptSettings({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<RuntimePromptSettings>(() => createDefaultRuntimePromptSettings());
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/settings/runtime-prompt", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as Partial<RuntimePromptSettings> & { error?: string };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!controller.signal.aborted) {
          setSettings(mergeSettings(createDefaultRuntimePromptSettings(), data));
          setReady(true);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setReady(true);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => controller.abort();
  }, []);

  const applyPatch = async (patch: RuntimePromptSettingsPatch) => {
    if (saving || !ready) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/runtime-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json() as Partial<RuntimePromptSettings> & { error?: string };
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSettings((current) => mergeSettings(current, data));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const busy = !ready || saving;

  const toggleExtension = (key: RuntimePromptExtensionKey) => {
    void applyPatch({ extensions: { [key]: !settings.extensions[key] } });
  };

  if (compact) {
    const enabledCount = RUNTIME_PROMPT_EXTENSION_KEYS.filter((key) => settings.extensions[key]).length;
    return (
      <div data-settings-id="conversation.runtimePrompt" aria-label={t("runtimePrompt.title")}>
        <SettingsSection
          title={t("runtimePrompt.title")}
          actions={
            <>
              <button
                type="button"
                className={primitiveStyles.button}
                disabled={busy}
                onClick={() => void applyPatch(createCliAlignedPresetSettings())}
              >
                {t("runtimePrompt.presetAlignCli")}
              </button>
              <button
                type="button"
                className={primitiveStyles.button}
                disabled={busy}
                onClick={() => void applyPatch(createDefaultRuntimePromptSettings())}
              >
                {t("runtimePrompt.presetDefault")}
              </button>
            </>
          }
        >
          {error ? (
            <div style={{ padding: "8px 16px" }}>
              <p role="alert" className={primitiveStyles.statusError}><ModelErrorText value={error} /></p>
            </div>
          ) : null}
          <SettingsRow
            title={t("runtimePrompt.mergeCompact.title")}
            description={t("runtimePrompt.mergeCompact.description")}
            descriptionId="runtimePrompt-mergeCompact-desc"
          >
            <SettingsSwitch
              checked={settings.mergeCompact}
              disabled={busy}
              label={t("runtimePrompt.mergeCompact.title")}
              describedBy="runtimePrompt-mergeCompact-desc"
              onToggle={() => void applyPatch({ mergeCompact: !settings.mergeCompact })}
            />
          </SettingsRow>
          <SettingsRow
            title={t("runtimePrompt.alignCliCompaction.title")}
            description={t("runtimePrompt.alignCliCompaction.description")}
            descriptionId="runtimePrompt-alignCliCompaction-desc"
          >
            <SettingsSwitch
              checked={settings.alignCliCompaction}
              disabled={busy}
              label={t("runtimePrompt.alignCliCompaction.title")}
              describedBy="runtimePrompt-alignCliCompaction-desc"
              onToggle={() => void applyPatch({ alignCliCompaction: !settings.alignCliCompaction })}
            />
          </SettingsRow>
          <SettingsDisclosure
            summary={t("runtimePrompt.extensionsGroup")}
            meta={`${enabledCount} / ${RUNTIME_PROMPT_EXTENSION_KEYS.length}`}
          >
            <div style={{ display: "grid", gap: 4 }}>
              {RUNTIME_PROMPT_EXTENSION_KEYS.map((key) => {
                const title = t(`runtimePrompt.ext.${key}.title`);
                const description = t(`runtimePrompt.ext.${key}.description`);
                const descId = `runtimePrompt-ext-${key}-desc`;
                return (
                  <SettingsRow key={key} title={title} description={description} descriptionId={descId}>
                    <SettingsSwitch
                      checked={settings.extensions[key]}
                      disabled={busy}
                      label={title}
                      describedBy={descId}
                      onToggle={() => toggleExtension(key)}
                    />
                  </SettingsRow>
                );
              })}
            </div>
          </SettingsDisclosure>
        </SettingsSection>
      </div>
    );
  }

  return (
    <section
      className={dialogStyles.promptCard}
      data-settings-id="conversation.runtimePrompt"
      aria-labelledby="runtime-prompt-heading"
    >
      <header className={dialogStyles.promptCardHeader}>
        <h3 id="runtime-prompt-heading">{t("runtimePrompt.title")}</h3>
        <p>{t("runtimePrompt.description")}</p>
      </header>
      <div className={styles.toolbar}>
        <div className={styles.presets}>
          <button
            type="button"
            className={styles.presetButton}
            disabled={busy}
            onClick={() => void applyPatch(createCliAlignedPresetSettings())}
          >
            {t("runtimePrompt.presetAlignCli")}
          </button>
          <button
            type="button"
            className={styles.presetButton}
            disabled={busy}
            onClick={() => void applyPatch(createDefaultRuntimePromptSettings())}
          >
            {t("runtimePrompt.presetDefault")}
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className={styles.errorText}>
          <ModelErrorText value={error} />
        </p>
      ) : null}
      <div className={dialogStyles.conversationRow}>
        <div className={dialogStyles.conversationCopy}>
          <div className={dialogStyles.rowTitle}>{t("runtimePrompt.mergeCompact.title")}</div>
          <div id="runtimePrompt-mergeCompact-desc" className={dialogStyles.rowDescription}>
            {t("runtimePrompt.mergeCompact.description")}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          className={dialogStyles.switch}
          aria-label={t("runtimePrompt.mergeCompact.title")}
          aria-describedby="runtimePrompt-mergeCompact-desc"
          aria-checked={settings.mergeCompact}
          disabled={busy}
          onClick={() => void applyPatch({ mergeCompact: !settings.mergeCompact })}
        >
          <span />
        </button>
      </div>
      <div className={dialogStyles.conversationRow}>
        <div className={dialogStyles.conversationCopy}>
          <div className={dialogStyles.rowTitle}>{t("runtimePrompt.alignCliCompaction.title")}</div>
          <div id="runtimePrompt-alignCliCompaction-desc" className={dialogStyles.rowDescription}>
            {t("runtimePrompt.alignCliCompaction.description")}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          className={dialogStyles.switch}
          aria-label={t("runtimePrompt.alignCliCompaction.title")}
          aria-describedby="runtimePrompt-alignCliCompaction-desc"
          aria-checked={settings.alignCliCompaction}
          disabled={busy}
          onClick={() => void applyPatch({ alignCliCompaction: !settings.alignCliCompaction })}
        >
          <span />
        </button>
      </div>
      <div className={styles.groupLabel}>{t("runtimePrompt.extensionsGroup")}</div>
      <div className={styles.extensionList}>
        {RUNTIME_PROMPT_EXTENSION_KEYS.map((key) => {
          const title = t(`runtimePrompt.ext.${key}.title`);
          const description = t(`runtimePrompt.ext.${key}.description`);
          const descId = `runtimePrompt-ext-${key}-desc`;
          return (
            <div key={key} className={styles.extensionItem}>
              <div className={styles.extensionCopy}>
                <div className={styles.extensionName}>{title}</div>
                <div id={descId} className={styles.extensionDesc}>{description}</div>
              </div>
              <button
                type="button"
                role="switch"
                className={dialogStyles.switch}
                aria-label={title}
                aria-describedby={descId}
                aria-checked={settings.extensions[key]}
                disabled={busy}
                onClick={() => toggleExtension(key)}
              >
                <span />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
