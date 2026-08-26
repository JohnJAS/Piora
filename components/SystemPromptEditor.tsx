"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import styles from "./SystemPromptEditor.module.css";

const MAX_SYSTEM_PROMPT_LENGTH = 100_000;

interface SystemPromptResponse {
  prompt: string | null;
  maxLength?: number;
  reloadedSessions?: number;
  deferredSessions?: number;
  error?: string;
}
interface Props {
  effectivePrompt: string | null;
  compact?: boolean;
  onSaved?: () => void;
}

export function SystemPromptEditor({ effectivePrompt, compact = false, onSaved }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [savedPrompt, setSavedPrompt] = useState<string | null>(null);
  const [maxLength, setMaxLength] = useState(MAX_SYSTEM_PROMPT_LENGTH);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/system-prompt", { cache: "no-store" });
      const data = await response.json() as SystemPromptResponse;
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSavedPrompt(data.prompt);
      setDraft(data.prompt ?? "");
      setMaxLength(data.maxLength ?? MAX_SYSTEM_PROMPT_LENGTH);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async (prompt: string | null) => {
    setSaving(true);
    setError(null);
    setStatus(t("system.refreshing"));
    try {
      const response = await fetch("/api/system-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await response.json() as SystemPromptResponse;
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSavedPrompt(data.prompt);
      setDraft(data.prompt ?? "");
      setStatus(t("system.saved", {
        reloaded: data.reloadedSessions ?? 0,
        deferred: data.deferredSessions ?? 0,
      }));
      window.dispatchEvent(new CustomEvent("piora:system-prompt-changed"));
      onSaved?.();
    } catch (saveError) {
      setStatus(null);
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [onSaved, t]);

  const dirty = draft !== (savedPrompt ?? "");
  const characterCount = Array.from(draft).length;

  return (
    <div className={`${styles.editor}${compact ? ` ${styles.compact}` : ""}`}>
      <div className={styles.scopeRow}>
        <span className={styles.stateBadge} data-custom={savedPrompt !== null}>
          {t(savedPrompt === null ? "system.defaultBadge" : "system.customBadge")}
        </span>
        <span>{t("system.scopeGlobal")}</span>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t("system.customLabel")}</span>
        <span className={styles.fieldDescription}>{t("system.customDescription")}</span>
        <textarea
          className={styles.textarea}
          value={draft}
          rows={compact ? 9 : 14}
          maxLength={maxLength}
          disabled={loading || saving}
          aria-label={t("system.customLabel")}
          placeholder={t("system.customPlaceholder")}
          onChange={(event) => {
            setDraft(event.target.value);
            setStatus(null);
            setError(null);
          }}
        />
      </label>

      <div className={styles.footer}>
        <div className={styles.feedback}>
          <span role={error ? "alert" : "status"} data-error={Boolean(error)}>
            {error ?? status ?? t(savedPrompt === null ? "system.defaultHint" : "system.customHint")}
          </span>
          <span className={styles.count}>{characterCount.toLocaleString()} / {maxLength.toLocaleString()}</span>
        </div>
        <div className={styles.actions}>
          <button className={styles.secondaryButton} type="button" disabled={loading || saving || savedPrompt === null} onClick={() => void persist(null)}>
            {t("system.restoreDefault")}
          </button>
          <button className={styles.primaryButton} type="button" disabled={loading || saving || !dirty} onClick={() => void persist(draft)}>
            {saving ? t("system.saving") : t("system.save")}
          </button>
        </div>
      </div>
      {!compact && (
        <details className={styles.effectivePrompt}>
          <summary>
            <span>
              <strong>{t("system.effectiveLabel")}</strong>
              <small>{t("system.effectiveDescription")}</small>
            </span>
          </summary>
          <pre>
            {effectivePrompt === null ? t("system.load") : effectivePrompt || t("system.empty")}
          </pre>
        </details>
      )}
    </div>
  );
}
