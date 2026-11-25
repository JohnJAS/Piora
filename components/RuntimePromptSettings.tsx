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

export function RuntimePromptSettings() {
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
