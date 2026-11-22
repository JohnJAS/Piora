"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { createDiscoveryAbort, requestDiscoveredModels, type DiscoveredModel } from "@/lib/model-discovery";
import { AliIcon } from "../AliIcon";
import { requestConfirmation } from "../ConfirmDialog";
import { ModelErrorText } from "../ModelErrorText";
import styles from "../ModelsConfig.module.css";
import { CompatOverridesEditor } from "./CompatEditors";
import { Field, inputStyle, SecretTextInput, Select, TextInput } from "./FormFields";
import { API_OPTIONS, type ModelDiscoveryState, type ModelTestState, type ProviderEntry } from "./types";

export function ProviderDetail({ name, editingName, provider, onChange, onNameChange, onDelete, onAddModels }: {
  name: string; editingName: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onNameChange: (n: string) => void; onDelete: () => void;
  onAddModels: (models: DiscoveredModel[]) => void;
}) {
  const { t } = useI18n();
  const [discoveryState, setDiscoveryState] = useState<ModelDiscoveryState>({ phase: "idle" });
  const [connectionTest, setConnectionTest] = useState<ModelTestState>({ phase: "idle" });
  const connectionRequestRef = useRef(0);
  useEffect(() => {
    const requests = connectionRequestRef;
    requests.current++;
    setConnectionTest({ phase: "idle" });
    return () => { requests.current++; };
  }, [name, provider]);
  const testConnection = async () => {
    const model = provider.models?.find(model => model.id.trim());
    if (!model || connectionTest.phase === "testing") return;
    const token = ++connectionRequestRef.current;
    setConnectionTest({ phase: "testing" });
    try {
      const response = await fetch("/api/models-config/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: name, provider, model }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; latencyMs?: number };
      if (token !== connectionRequestRef.current) return;
      setConnectionTest(response.ok && result.ok ? { phase: "success", latencyMs: result.latencyMs } : { phase: "error", message: result.error ?? `HTTP ${response.status}` });
    } catch (error) {
      if (token === connectionRequestRef.current) setConnectionTest({ phase: "error", message: String(error) });
    }
  };
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const discoveryRequestIdRef = useRef(0);
  const discoveryAbortRef = useRef<ReturnType<typeof createDiscoveryAbort> | null>(null);
  const selectShownRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api]);

  useEffect(() => {
    discoveryRequestIdRef.current += 1;
    const current = discoveryAbortRef.current;
    discoveryAbortRef.current = null;
    current?.cancel();
    current?.dispose();
    setDiscoveryState({ phase: "idle" });
    setDiscoveryQuery("");
    setSelectedModelIds([]);
  }, [name, provider.baseUrl, provider.api, provider.apiKey]);

  useEffect(() => () => {
    const current = discoveryAbortRef.current;
    discoveryAbortRef.current = null;
    current?.cancel();
    current?.dispose();
  }, []);

  const handleDiscoverModels = useCallback(async () => {
    if (!provider.baseUrl?.trim() || discoveryState.phase === "loading") return;
    const requestId = ++discoveryRequestIdRef.current;
    const previous = discoveryAbortRef.current;
    discoveryAbortRef.current = null;
    previous?.cancel();
    previous?.dispose();
    const discovery = createDiscoveryAbort();
    discoveryAbortRef.current = discovery;
    setDiscoveryState({ phase: "loading" });
    setSelectedModelIds([]);
    try {
      const data = await requestDiscoveredModels({ providerName: name, provider, signal: discovery.signal });
      if (requestId !== discoveryRequestIdRef.current || discoveryAbortRef.current !== discovery) return;
      setDiscoveryState({ phase: "success", models: data.models, endpoint: data.endpoint ?? provider.baseUrl ?? "" });
    } catch (error) {
      if (requestId !== discoveryRequestIdRef.current || discoveryAbortRef.current !== discovery) return;
      if (discovery.signal.aborted && !discovery.timedOut()) return;
      setDiscoveryState({
        phase: "error",
        message: discovery.timedOut() ? t("models.limits.fetchTimeout") : error instanceof Error ? error.message : String(error),
      });
    } finally {
      discovery.dispose();
      if (discoveryAbortRef.current === discovery) discoveryAbortRef.current = null;
    }
  }, [discoveryState.phase, name, provider, t]);

  const existingModelIds = new Set((provider.models ?? []).map((model) => model.id));
  const discoveredModels = discoveryState.phase === "success" ? discoveryState.models : [];
  const normalizedDiscoveryQuery = discoveryQuery.trim().toLocaleLowerCase();
  const filteredDiscoveredModels = discoveredModels.filter((model) => !normalizedDiscoveryQuery
    || model.id.toLocaleLowerCase().includes(normalizedDiscoveryQuery)
    || model.name?.toLocaleLowerCase().includes(normalizedDiscoveryQuery));
  const shownDiscoveredModels = filteredDiscoveredModels.slice(0, 300);
  const selectableShownIds = shownDiscoveredModels
    .filter((model) => !existingModelIds.has(model.id))
    .map((model) => model.id);
  const selectedCount = selectedModelIds.filter((id) => !existingModelIds.has(id)).length;
  const allShownSelected = selectableShownIds.length > 0
    && selectableShownIds.every((id) => selectedModelIds.includes(id));
  const someShownSelected = !allShownSelected
    && selectableShownIds.some((id) => selectedModelIds.includes(id));

  useEffect(() => {
    if (selectShownRef.current) selectShownRef.current.indeterminate = someShownSelected;
  }, [someShownSelected]);

  const toggleDiscoveredModel = (id: string) => {
    setSelectedModelIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  };

  const toggleShownModels = () => {
    const shownIds = new Set(selectableShownIds);
    setSelectedModelIds((current) => allShownSelected
      ? current.filter((id) => !shownIds.has(id))
      : Array.from(new Set([...current, ...selectableShownIds])));
  };

  const addSelectedModels = () => {
    if (discoveryState.phase !== "success") return;
    const selected = new Set(selectedModelIds);
    const additions = discoveryState.models.filter((model) => selected.has(model.id) && !existingModelIds.has(model.id));
    if (additions.length === 0) return;
    onAddModels(additions);
    setSelectedModelIds([]);
  };

  return (
    <div className={styles.connectionCard} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className={styles.connectionHeader} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className={styles.connectionTitle}><AliIcon name="api" size={21} /><span>{name}</span></div>
        <button onClick={async () => {
          if (await requestConfirmation({ title: t("i18n.delete"), message: t("models.deleteProviderConfirm", { name }), confirmLabel: t("i18n.delete"), tone: "danger" })) onDelete();
        }}
          style={{ padding: "3px 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: "var(--text-xs)" }}>
          {t("i18n.delete")}
        </button>
      </div>

      <Field label={t("models.ui.providerName")}>
        <TextInput value={editingName} onChange={onNameChange} placeholder="provider-name" mono />
      </Field>

      <Field label={t("models.form.endpoint")}>
        <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="https://api.example.com/v1" mono />
      </Field>

      <Field label={t("models.form.secretKey")}>
        <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
          placeholder={t("models.form.keyHint")} mono />
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 2 }}>
          {t("models.form.secretHint")}
        </span>
      </Field>

      <Field label={t("models.form.protocol")}>
        <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
      </Field>

      <div className={styles.connectionActions}>
        <button className={styles.testConnection} disabled={!provider.models?.some(model => model.id.trim()) || connectionTest.phase === "testing"} title={!provider.models?.some(model => model.id.trim()) ? t("models.ui.testNeedsModel") : undefined} onClick={() => void testConnection()}><AliIcon name="link" size={16} />{connectionTest.phase === "testing" ? t("i18n.checking") : t("models.ui.testConnection")}</button>
        <button className={styles.testConnection} onClick={() => void handleDiscoverModels()} disabled={!provider.baseUrl?.trim() || discoveryState.phase === "loading"}><AliIcon name="search" size={15} />{discoveryState.phase === "loading" ? t("models.discoveryFetching") : t("models.discoveryFetch")}</button>
        {connectionTest.phase === "success" ? <span role="status" className={styles.connectionResult}>✓ {t("models.ui.connectionPassed")}{connectionTest.latencyMs != null ? ` · ${connectionTest.latencyMs} ms` : ""}</span> : null}
      </div>
      {connectionTest.phase === "error" ? <div role="alert"><ModelErrorText value={connectionTest.message} /></div> : null}
      <details className={styles.advanced} style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: "var(--text-sm)", fontWeight: 600 }}>{t("models.advancedSettings")}</summary>
        <div style={{ paddingTop: 12 }}>
          <CompatOverridesEditor compat={provider.compat} onChange={(c) => set("compat", c)} />
        </div>
      </details>

      <div className={styles.importArea} style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {discoveryState.phase === "error" && (
          <div style={{ padding: "7px 9px", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius-control)", color: "#ef4444", fontSize: "var(--text-xs)", lineHeight: 1.4 }}>
            {<ModelErrorText value={discoveryState.message} />}
          </div>
        )}

        {discoveryState.phase === "success" && (
          <>
            <input
              value={discoveryQuery}
              onChange={(event) => setDiscoveryQuery(event.target.value)}
              placeholder={t("models.discoveryFilterPlaceholder", { count: discoveryState.models.length })}
              aria-label={t("models.discoveryFilter")}
              style={{ ...inputStyle, width: "100%", minWidth: 0 }}
            />

            <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)" }}>
              <label
                style={{
                  minHeight: 32, padding: "5px 9px", display: "flex", alignItems: "center", gap: 8,
                  position: "sticky", top: 0, zIndex: 1, borderBottom: "1px solid var(--border)",
                  background: "var(--bg)", cursor: selectableShownIds.length ? "pointer" : "default",
                  color: "var(--text-muted)", fontSize: "var(--text-xs)", fontWeight: 600,
                }}
              >
                <input
                  ref={selectShownRef}
                  type="checkbox"
                  checked={allShownSelected}
                  disabled={selectableShownIds.length === 0}
                  onChange={toggleShownModels}
                  style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                />
                {t("models.discoverySelectShown")}
              </label>
              {shownDiscoveredModels.length === 0 ? (
                <div style={{ padding: 12, color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>{t("models.discoveryNoMatches")}</div>
              ) : shownDiscoveredModels.map((model, index) => {
                const alreadyAdded = existingModelIds.has(model.id);
                const checked = selectedModelIds.includes(model.id);
                return (
                  <label
                    key={model.id}
                    style={{
                      minHeight: 36, padding: "6px 9px", display: "flex", alignItems: "center", gap: 8,
                      borderTop: index === 0 ? "none" : "1px solid var(--border)", cursor: alreadyAdded ? "default" : "pointer",
                      opacity: alreadyAdded ? 0.65 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked || alreadyAdded}
                      disabled={alreadyAdded}
                      onChange={() => toggleDiscoveredModel(model.id)}
                      style={{ width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 }}
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: "var(--text-xs)" }}>{model.name ?? model.id}</span>
                      {model.name && <code style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>{model.id}</code>}
                    </span>
                    {alreadyAdded && <span style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>{t("models.discoveryAdded")}</span>}
                  </label>
                );
              })}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span title={discoveryState.endpoint} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>
                {filteredDiscoveredModels.length > shownDiscoveredModels.length
                  ? t("models.discoveryShowing", { shown: shownDiscoveredModels.length, total: filteredDiscoveredModels.length })
                  : t("models.discoveryFetched", { count: discoveryState.models.length })}
              </span>
              <button
                onClick={addSelectedModels}
                disabled={selectedCount === 0}
                style={{ height: 28, padding: "0 11px", border: "none", borderRadius: "var(--radius-control)", background: selectedCount ? "var(--accent)" : "var(--bg-panel)", color: selectedCount ? "#fff" : "var(--text-dim)", cursor: selectedCount ? "pointer" : "not-allowed", fontSize: "var(--text-xs)", fontWeight: 600, whiteSpace: "nowrap" }}
              >
                {selectedCount
                  ? t("models.discoveryAddSelectedCount", { count: selectedCount })
                  : t("models.discoveryAddSelected")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
