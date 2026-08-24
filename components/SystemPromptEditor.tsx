"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";

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

  return (
    <div style={{ display: "grid", gap: compact ? 8 : 12 }}>
      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ color: "var(--text)", fontSize: "var(--text-xs)", fontWeight: 650 }}>{t("system.customLabel")}</span>
        <textarea
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
          style={{
            width: "100%",
            minHeight: compact ? 174 : 240,
            resize: "vertical",
            boxSizing: "border-box",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg)",
            color: "var(--text)",
            padding: "10px 11px",
            font: "400 var(--text-xs)/1.55 var(--font-mono)",
            outline: "none",
          }}
        />
      </label>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span role={error ? "alert" : "status"} style={{ color: error ? "#dc2626" : "var(--text-dim)", fontSize: "var(--text-xs)" }}>
          {error ?? status ?? t(savedPrompt === null ? "system.defaultHint" : "system.customHint")}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <button type="button" disabled={loading || saving || savedPrompt === null} onClick={() => void persist(null)}>
            {t("system.restoreDefault")}
          </button>
          <button type="button" disabled={loading || saving || !dirty} onClick={() => void persist(draft)}>
            {saving ? t("system.saving") : t("system.save")}
          </button>
        </div>
      </div>
      {!compact && (
        <details>
          <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>{t("system.effectiveLabel")}</summary>
          <pre style={{ marginTop: 8, maxHeight: 280, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {effectivePrompt === null ? t("system.load") : effectivePrompt || t("system.empty")}
          </pre>
        </details>
      )}
    </div>
  );
}
