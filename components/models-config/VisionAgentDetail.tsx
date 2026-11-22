"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import { ModelErrorText } from "../ModelErrorText";
import { Field, inputStyle } from "./FormFields";
import type {
  VisionAgentConfigState,
  VisionAgentModelOption,
  VisionAgentResponse,
  VisionAgentTestState,
} from "./types";

function visualModelValue(model: Pick<VisionAgentModelOption, "provider" | "modelId">): string {
  return JSON.stringify([model.provider, model.modelId]);
}

export function VisionAgentDetail({ cwd }: { cwd?: string }) {
  const { t } = useI18n();
  const [config, setConfig] = useState<VisionAgentConfigState>({ enabled: false, provider: null, modelId: null });
  const [models, setModels] = useState<VisionAgentModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<VisionAgentTestState>({ phase: "idle" });

  useEffect(() => {
    let active = true;
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    fetch(`/api/vision-agent${query}`)
      .then(async (response) => {
        const body = await response.json() as VisionAgentResponse;
        if (!active) return;
        if (body.config) setConfig(body.config);
        setModels(Array.isArray(body.models) ? body.models : []);
        if (!response.ok || body.error) setError(body.error ?? `HTTP ${response.status}`);
      })
      .catch((loadError) => { if (active) setError(String(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cwd]);

  const selectedValue = config.provider && config.modelId
    ? visualModelValue({ provider: config.provider, modelId: config.modelId })
    : "";
  const selectedIsAvailable = models.some((model) => visualModelValue(model) === selectedValue);
  const staleSelected = selectedValue && !selectedIsAvailable
    ? { provider: config.provider!, modelId: config.modelId!, name: t("models.visualModelUnavailable") }
    : null;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/vision-agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, ...(cwd ? { cwd } : {}) }),
      });
      const body = await response.json() as { config?: VisionAgentConfigState; error?: string };
      if (!response.ok || body.error || !body.config) throw new Error(body.error ?? `HTTP ${response.status}`);
      setConfig(body.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2_000);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!config.provider || !config.modelId) return;
    setTestState({ phase: "testing" });
    setError(null);
    try {
      const response = await fetch("/api/vision-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, ...(cwd ? { cwd } : {}) }),
      });
      const body = await response.json() as { ok?: boolean; latencyMs?: number; observation?: string; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setTestState({ phase: "success", latencyMs: body.latencyMs ?? 0, observation: body.observation ?? "" });
    } catch (testError) {
      setTestState({ phase: "error", message: testError instanceof Error ? testError.message : String(testError) });
    }
  };

  if (loading) {
    return <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>{t("i18n.loading")}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: "var(--radius-control)", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--bg-selected)", color: "var(--accent)" }}>
          <AliIcon name="eye" size={18} />
        </span>
        <div>
          <div style={{ color: "var(--text)", fontSize: "var(--text-md)", fontWeight: 700 }}>{t("models.visualAgent")}</div>
          <div style={{ marginTop: 2, color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>{t("models.visualAgentSubtitle")}</div>
        </div>
      </div>

      <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => setConfig((current) => ({ ...current, enabled: event.target.checked }))}
            style={{ width: 15, height: 15, marginTop: 2, accentColor: "var(--accent)" }}
          />
          <span>
            <span style={{ display: "block", color: "var(--text)", fontSize: "var(--text-sm)", fontWeight: 600 }}>{t("models.visualAgentEnable")}</span>
            <span style={{ display: "block", marginTop: 3, color: "var(--text-muted)", fontSize: "var(--text-xs)", lineHeight: 1.5 }}>{t("models.visualAgentEnableHint")}</span>
          </span>
        </label>

        <Field label={t("models.visualModel")}>
          <select
            value={selectedValue}
            onChange={(event) => {
              if (!event.target.value) {
                setConfig((current) => ({ ...current, provider: null, modelId: null }));
                return;
              }
              const [provider, modelId] = JSON.parse(event.target.value) as [string, string];
              setConfig((current) => ({ ...current, provider, modelId }));
            }}
            style={inputStyle}
          >
            <option value="">{t("models.visualModelSelect")}</option>
            {staleSelected && (
              <option value={visualModelValue(staleSelected)}>{staleSelected.provider} · {staleSelected.modelId} ({staleSelected.name})</option>
            )}
            {models.map((model) => (
              <option key={visualModelValue(model)} value={visualModelValue(model)}>
                {model.provider} · {model.name || model.modelId} ({model.modelId})
              </option>
            ))}
          </select>
        </Field>

        {models.length === 0 && (
          <div role="note" style={{ color: "#b45309", fontSize: "var(--text-xs)", lineHeight: 1.5 }}>{t("models.visualModelEmpty")}</div>
        )}
        <div role="note" style={{ padding: "9px 10px", borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text-muted)", fontSize: "var(--text-xs)", lineHeight: 1.55 }}>
          {t("models.visualAgentRoutingHint")}
        </div>
        <div role="note" style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", lineHeight: 1.55 }}>
          {t("models.visualAgentPrivacyHint")}
        </div>
      </div>

      {error && <div role="alert" style={{ color: "#dc2626", fontSize: "var(--text-sm)" }}>{<ModelErrorText value={error} />}</div>}
      {testState.phase === "success" && <div role="status" style={{ color: "#15803d", fontSize: "var(--text-xs)", lineHeight: 1.5 }}>{t("models.visualAgentTestSuccess", { latency: testState.latencyMs })} · {testState.observation}</div>}
      {testState.phase === "error" && <div role="alert" style={{ color: "#dc2626", fontSize: "var(--text-xs)" }}>{<ModelErrorText value={testState.message} />}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || saved || (config.enabled && (!selectedValue || !selectedIsAvailable))}
          style={{ minWidth: 112, padding: "7px 14px", border: "none", borderRadius: "var(--radius-control)", background: saved ? "#16a34a" : "var(--accent)", color: "#fff", fontSize: "var(--text-sm)", fontWeight: 600, cursor: saving || saved || (config.enabled && (!selectedValue || !selectedIsAvailable)) ? "not-allowed" : "pointer", opacity: saving || (config.enabled && (!selectedValue || !selectedIsAvailable)) ? 0.55 : 1 }}
        >
          {saved ? t("i18n.saved") : saving ? t("i18n.saving") : t("models.visualAgentSave")}
        </button>
        <button
          type="button"
          onClick={() => void test()}
          disabled={!selectedValue || !selectedIsAvailable || testState.phase === "testing"}
          style={{ padding: "7px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: "var(--text-sm)", cursor: !selectedValue || !selectedIsAvailable || testState.phase === "testing" ? "not-allowed" : "pointer", opacity: !selectedValue || !selectedIsAvailable ? 0.55 : 1 }}
        >
          {testState.phase === "testing" ? t("models.visualAgentTesting") : t("models.visualAgentTest")}
        </button>
      </div>
    </div>
  );
}
