"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ModelCatalogPreset, ModelCatalogRecommendation } from "@/lib/model-catalog";
import { createDiscoveryAbort, requestDiscoveredModels, type DiscoveredModel } from "@/lib/model-discovery";
import {
  applyEndpointLimits,
  automaticModelLimitSources,
  captureModelLimitUndo,
  clearLimitMetaField,
  compactLimitMeta,
  constrainToEndpointLimits,
  findDiscoveredModel,
  modelLimitFieldProblem,
  modelLimitProblem,
  parseModelLimitDraft,
  positiveTokenCount,
  undoModelLimitEdits,
  type ModelLimitField,
  type ModelLimitsMeta,
} from "@/lib/model-limits";
import { AliIcon } from "../AliIcon";
import { ModelErrorText } from "../ModelErrorText";
import { ModelSamplingEditor } from "../ModelSamplingEditor";
import { CompatOverridesEditor, hasDeepseekCompat, setDeepseekCompat, ThinkingLevelMapEditor } from "./CompatEditors";
import { Check, Field, NumInput, SectionTitle, Select, TextInput } from "./FormFields";
import { API_OPTIONS, type ModelCatalogState, type ModelEntry, type ModelTestState, type ProviderEntry } from "./types";

function fillEmptyModelFields(
  model: ModelEntry,
  preset: ModelCatalogPreset,
): { model: ModelEntry; appliedCount: number } {
  // models.dev is only this manual button. automaticModelLimitSources() does not include it.
  const next = { ...model };
  let appliedCount = 0;
  const meta: ModelLimitsMeta = {
    ...(model.limitsMeta?.contextWindow ? { contextWindow: model.limitsMeta.contextWindow } : {}),
    ...(model.limitsMeta?.maxTokens ? { maxTokens: model.limitsMeta.maxTokens } : {}),
    ...(model.limitsMeta?.unavailable ? { unavailable: { ...model.limitsMeta.unavailable } } : {}),
  };
  if (!model.name?.trim() && preset.name) {
    next.name = preset.name;
    appliedCount += 1;
  }
  if (model.reasoning === undefined && preset.reasoning === true) {
    next.reasoning = true;
    appliedCount += 1;
  }
  if (!model.input?.length && preset.input?.length) {
    next.input = [...preset.input];
    appliedCount += 1;
  }
  if (model.contextWindow === undefined) {
    const value = positiveTokenCount(preset.contextWindow);
    if (value !== undefined) {
      next.contextWindow = value;
      meta.contextWindow = "models.dev";
      if (meta.unavailable) delete meta.unavailable.contextWindow;
      appliedCount += 1;
    }
  }
  if (model.maxTokens === undefined) {
    const value = positiveTokenCount(preset.maxTokens);
    if (value !== undefined) {
      next.maxTokens = value;
      meta.maxTokens = "models.dev";
      if (meta.unavailable) delete meta.unavailable.maxTokens;
      appliedCount += 1;
    }
  }
  const compacted = compactLimitMeta(meta);
  if (compacted) next.limitsMeta = compacted;
  else delete next.limitsMeta;

  if (preset.cost) {
    const cost = { ...(model.cost ?? {}) };
    let costChanged = false;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      if (cost[key] === undefined && preset.cost[key] !== undefined) {
        cost[key] = preset.cost[key];
        costChanged = true;
        appliedCount += 1;
      }
    }
    if (costChanged) next.cost = cost;
  }
  return { model: next, appliedCount };
}

export function ModelLimitFields({
  providerName,
  provider,
  model,
  onChange,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
}) {
  const { t } = useI18n();
  const limitsAbortRef = useRef<ReturnType<typeof createDiscoveryAbort> | null>(null);
  const limitsUndoRef = useRef<ReturnType<typeof captureModelLimitUndo> | null>(null);
  const latestModelRef = useRef(model);
  latestModelRef.current = model;
  const [limitsPhase, setLimitsPhase] = useState<"idle" | "loading">("idle");
  const [limitsError, setLimitsError] = useState<string | null>(null);
  const [queriedLimits, setQueriedLimits] = useState<DiscoveredModel | null>(null);
  const endpointSource = automaticModelLimitSources().includes("endpoint");
  const contextConflict = queriedLimits?.contextWindow !== undefined && model.contextWindow !== undefined
    && model.contextWindow > queriedLimits.contextWindow;
  const outputConflict = queriedLimits?.maxTokens !== undefined && model.maxTokens !== undefined
    && model.maxTokens > queriedLimits.maxTokens;

  useEffect(() => () => {
    const current = limitsAbortRef.current;
    limitsAbortRef.current = null;
    current?.cancel();
    current?.dispose();
  }, []);

  useEffect(() => {
    const current = limitsAbortRef.current;
    limitsAbortRef.current = null;
    current?.cancel();
    current?.dispose();
    limitsUndoRef.current = null;
    setLimitsError(null);
    setQueriedLimits(null);
    setLimitsPhase("idle");
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, provider.headers, model.id, model.baseUrl, model.api]);

  const setLimit = (field: ModelLimitField, raw: string) => {
    onChange({
      ...model,
      [field]: parseModelLimitDraft(raw),
      limitsMeta: clearLimitMetaField(model.limitsMeta, field),
    });
  };

  const handleFetchLimits = async () => {
    if (!endpointSource || limitsPhase === "loading") return;
    if (!(model.baseUrl || provider.baseUrl)?.trim()) {
      setLimitsError(t("models.limits.fetchNeedsEndpoint"));
      return;
    }
    if (!model.id.trim()) {
      setLimitsError(t("models.limits.fetchNeedsId"));
      return;
    }
    const previous = limitsAbortRef.current;
    limitsAbortRef.current = null;
    previous?.cancel();
    previous?.dispose();
    const discovery = createDiscoveryAbort();
    limitsAbortRef.current = discovery;
    setLimitsPhase("loading");
    setLimitsError(null);
    setQueriedLimits(null);
    try {
      const data = await requestDiscoveredModels({ providerName, provider: {
        ...provider,
        ...(model.baseUrl ? { baseUrl: model.baseUrl } : {}),
        ...(model.api ? { api: model.api } : {}),
      }, signal: discovery.signal });
      if (limitsAbortRef.current !== discovery) return;
      const match = findDiscoveredModel(data.models, model.id);
      setQueriedLimits(match ?? null);
      const currentModel = latestModelRef.current;
      const applied = applyEndpointLimits(currentModel, match);
      if (applied.changed) {
        limitsUndoRef.current = captureModelLimitUndo(currentModel, applied.model);
        onChange(applied.model);
      }
      if (!match) setLimitsError(t("models.limits.modelNotListed"));
    } catch (error) {
      if (limitsAbortRef.current !== discovery) return;
      if (discovery.signal.aborted && !discovery.timedOut()) return;
      setLimitsError(discovery.timedOut()
        ? t("models.limits.fetchTimeout")
        : error instanceof Error ? error.message : String(error));
    } finally {
      discovery.dispose();
      if (limitsAbortRef.current === discovery) {
        limitsAbortRef.current = null;
        setLimitsPhase("idle");
      }
    }
  };

  const hint = (field: ModelLimitField): { text: string; tone: "error" | "source"; source?: string; missing?: boolean } | null => {
    const pair = modelLimitProblem(model);
    if (pair?.code === "output-exceeds-context") return { text: t("models.limits.outputTooLarge", { context: model.contextWindow ?? "" }), tone: "error" };
    const problem = modelLimitFieldProblem(model[field], field);
    if (problem?.code === "required" && model.limitsMeta?.unavailable?.[field]) {
      return { text: t("models.limits.endpointMissing"), tone: "error", missing: true };
    }
    if (problem?.code === "required") return { text: t("models.limits.required"), tone: "error" };
    if (problem?.code === "not-positive-integer") return { text: t("models.limits.notInteger"), tone: "error" };
    const source = model.limitsMeta?.[field];
    if (source === "endpoint") return { text: t("models.limits.sourceEndpoint"), tone: "source", source };
    if (source === "default") return { text: t("models.limits.sourceDefault"), tone: "source", source };
    if (source === "models.dev") return { text: t("models.limits.sourceCatalog"), tone: "source", source };
    return null;
  };

  const field = (name: ModelLimitField, label: string) => {
    const note = hint(name);
    const invalid = note?.tone === "error";
    return (
      <div data-model-limit-field={name} style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 4 }}>
        <Field label={<>{label}<span style={{ color: "#ef4444" }}> *</span></>}>
          <NumInput
            value={model[name] !== undefined ? String(model[name]) : ""}
            onChange={(value) => setLimit(name, value)}
            placeholder={t("models.limits.requiredPlaceholder")}
            invalid={invalid}
          />
        </Field>
        {note && (
          <span
            data-limit-source={note.source}
            data-limit-endpoint-missing={note.missing ? "true" : undefined}
            style={{ color: note.tone === "error" ? "#ef4444" : "var(--text-dim)", fontSize: "var(--text-xs)", lineHeight: 1.4 }}
          >
            {note.text}
          </span>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        {field("contextWindow", t("models.form.contextWindow"))}
        {field("maxTokens", t("models.form.maxTokens"))}
        {endpointSource && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", paddingTop: 20 }}>
            <button
              type="button"
              onClick={() => void handleFetchLimits()}
              disabled={limitsPhase === "loading"}
              style={{
                height: 30, padding: "0 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)",
                background: "var(--bg-panel)",
                color: limitsPhase === "loading" ? "var(--text-dim)" : "var(--text-muted)",
                cursor: limitsPhase === "loading" ? "not-allowed" : "pointer",
                fontSize: "var(--text-xs)",
              }}
            >
              {limitsPhase === "loading" ? t("models.limits.fetching") : t("models.limits.fetch")}
            </button>
            {limitsUndoRef.current && (
              <button
                type="button"
                onClick={() => {
                  const previous = limitsUndoRef.current;
                  if (!previous) return;
                  limitsUndoRef.current = null;
                  setLimitsError(null);
                  onChange(undoModelLimitEdits(latestModelRef.current, previous));
                }}
                style={{ padding: "0 2px", border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--text-xs)" }}
              >
                {t("models.catalogUndo")}
              </button>
            )}
          </div>
        )}
      </div>
      {queriedLimits && (contextConflict || outputConflict) && (
        <div data-endpoint-limit-conflict role="alert" style={{ marginTop: 6, color: "#ef4444", fontSize: "var(--text-xs)", lineHeight: 1.5 }}>
          {contextConflict && <div>{t("models.limits.endpointContextConflict", { endpoint: queriedLimits.contextWindow!, configured: model.contextWindow! })}</div>}
          {outputConflict && <div>{t("models.limits.endpointOutputConflict", { endpoint: queriedLimits.maxTokens!, configured: model.maxTokens! })}</div>}
          <button type="button" onClick={() => {
            const applied = constrainToEndpointLimits(model, queriedLimits);
            limitsUndoRef.current = captureModelLimitUndo(model, applied);
            onChange(applied);
          }} style={{ border: "none", background: "none", padding: 0, color: "var(--accent)", cursor: "pointer" }}>
            {t("models.limits.useEndpoint")}
          </button>
        </div>
      )}
      {queriedLimits && queriedLimits.contextWindow === undefined && queriedLimits.maxTokens === undefined && (
        <p data-endpoint-limits-unknown style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>
          {t("models.limits.endpointUnknown")}
        </p>
      )}
      {limitsError && (
        <div role="alert" style={{ marginTop: 6, color: "#ef4444", fontSize: "var(--text-xs)", lineHeight: 1.4 }}>
          <ModelErrorText value={limitsError} />
        </div>
      )}
      <p data-model-limits-help style={{ margin: "8px 0 0", color: "var(--text-dim)", fontSize: "var(--text-xs)", lineHeight: 1.5, whiteSpace: "pre-line" }}>
        {t("models.limits.help")}
      </p>
    </div>
  );
}

export function ModelDetail({
  providerName,
  provider,
  model,
  onChange,
  onDelete,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
}) {
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const { t } = useI18n();
  const [catalogState, setCatalogState] = useState<ModelCatalogState>({ phase: "idle" });
  const catalogRequestIdRef = useRef(0);
  const catalogUndoRef = useRef<ModelEntry | null>(null);
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const costVal = (k: keyof NonNullable<ModelEntry["cost"]>) => model.cost?.[k] !== undefined ? String(model.cost[k]) : "";
  const setCost = (k: keyof NonNullable<ModelEntry["cost"]>, v: string) => {
    const n = parseFloat(v);
    onChange({ ...model, cost: { ...(model.cost ?? {}), [k]: isNaN(n) ? undefined : n } });
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
    if (testState.phase === "testing") return t("i18n.testingModel");
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
      return [t("i18n.connected"), ...meta, testState.responseText || null].filter(Boolean).join(" · ");
    }
    return [t("i18n.failed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  useEffect(() => {
    catalogRequestIdRef.current += 1;
    setCatalogState({ phase: "idle" });
    catalogUndoRef.current = null;
  }, [providerName, provider.baseUrl, model.id]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
      });
      const d = await res.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok || !d.ok) {
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  const handleCatalogFill = useCallback(async () => {
    const query = model.id.trim();
    if (!query || catalogState.phase === "loading") return;
    const requestId = ++catalogRequestIdRef.current;
    setCatalogState({ phase: "loading" });
    try {
      const params = new URLSearchParams({ q: query, provider: providerName, limit: "50" });
      if (provider.baseUrl?.trim()) params.set("baseUrl", provider.baseUrl.trim());
      const res = await fetch(`/api/models-config/catalog?${params}`);
      const data = await res.json() as { recommendation?: ModelCatalogRecommendation; error?: string };
      if (requestId !== catalogRequestIdRef.current) return;
      if (!res.ok || data.error || !data.recommendation) {
        setCatalogState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const filled = fillEmptyModelFields(model, data.recommendation.preset);
      if (filled.appliedCount > 0) {
        catalogUndoRef.current = model;
        onChange(filled.model);
      }
      setCatalogState({
        phase: "success",
        recommendation: data.recommendation,
        appliedCount: filled.appliedCount,
      });
    } catch (error) {
      if (requestId !== catalogRequestIdRef.current) return;
      setCatalogState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [catalogState.phase, model, onChange, provider.baseUrl, providerName]);

  const undoCatalogFill = () => {
    const previous = catalogUndoRef.current;
    if (!previous) return;
    catalogUndoRef.current = null;
    onChange(previous);
    setCatalogState({ phase: "idle" });
  };

  const catalogResultSummary = (() => {
    if (catalogState.phase !== "success") return null;
    const { recommendation, appliedCount } = catalogState;
    const applied = appliedCount > 0
      ? t("models.catalogFilled", { count: appliedCount })
      : t("models.catalogNoEmptyFields");
    if (recommendation.price.status === "unreliable") {
      const price = recommendation.price.reason === "no-exact-match"
        ? t("models.catalogNoExactMatch")
        : t("models.catalogPriceUnreliable");
      return `${applied} · ${price}`;
    }
    const price = recommendation.price.method === "provider"
      ? t("models.catalogPriceProvider", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
      : recommendation.price.method === "base-url"
        ? t("models.catalogPriceBaseUrl", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
        : t("models.catalogPriceConsensus", {
            support: recommendation.price.support,
            total: recommendation.price.total,
          });
    return `${applied} · ${price}`;
  })();
  const catalogStatusText = catalogState.phase === "error"
    ? catalogState.message
    : catalogResultSummary;
  const catalogStatusColor = catalogState.phase === "error"
    ? "#ef4444"
    : catalogState.phase === "success" && catalogState.recommendation.price.status === "unreliable"
      ? "#d97706"
      : "var(--text-dim)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("i18n.model")}</SectionTitle>
        <button onClick={onDelete}
          style={{ height: 24, padding: "0 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: "var(--text-xs)", boxSizing: "border-box" }}>
          {t("i18n.remove")}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label={t("models.form.modelId")}>
          <TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono invalid={!model.id.trim()} />
          {!model.id.trim() && <span data-model-id-required style={{ color: "#ef4444", fontSize: "var(--text-xs)", lineHeight: 1.4 }}>{t("models.modelIdRequired")}</span>}
        </Field>
        <Field label={t("models.form.name")}><TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder={t("models.form.displayName")} /></Field>
      </div>

      <div data-draft-model-test-actions style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 30 }}>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={!model.id.trim() || testState.phase === "testing"}
          title={model.id.trim() ? t("i18n.testConnection") : t("models.testRequiresId")}
          aria-label={t("i18n.testConnection")}
          style={{
            height: 30,
            padding: "0 11px",
            background: testState.phase === "success" ? "#16a34a" : "var(--bg-panel)",
            border: `1px solid ${testState.phase === "success" ? "#16a34a" : "var(--border)"}`,
            borderRadius: "var(--radius-control)",
            color: testState.phase === "success" ? "#fff" : (!model.id.trim() || testState.phase === "testing") ? "var(--text-dim)" : "var(--text-muted)",
            cursor: (!model.id.trim() || testState.phase === "testing") ? "not-allowed" : "pointer",
            fontSize: "var(--text-xs)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            gap: 5,
            flexShrink: 0,
          }}
        >
          {testState.phase === "success" && <AliIcon name="check" size={11} />}
          {testState.phase === "testing"
            ? t("i18n.checking")
            : testState.phase === "success"
              ? t("common.ok")
              : t("i18n.testConnection")}
        </button>
        {testSummary && (
          <span
            title={testSummary}
            aria-live="polite"
            style={{
              minWidth: 0,
              maxWidth: 420,
              height: 30,
              padding: "0 9px",
              border: `1px solid ${testState.phase === "error" ? "#fecaca" : testState.phase === "success" ? "#bbf7d0" : "var(--border)"}`,
              borderRadius: "var(--radius-control)",
              background: testState.phase === "error" ? "#fee2e2" : testState.phase === "success" ? "#dcfce7" : "#e5e7eb",
              color: "#111827",
              fontSize: "var(--text-xs)",
              display: "inline-flex",
              alignItems: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              boxSizing: "border-box",
            }}
          >
            {testState.phase === "error" ? <ModelErrorText value={testSummary} /> : testSummary}
          </span>
        )}
      </div>

      <div style={{ padding: "10px 0", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => void handleCatalogFill()}
            disabled={!model.id.trim() || catalogState.phase === "loading"}
            style={{
              height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)",
              background: "var(--bg-panel)",
              color: !model.id.trim() || catalogState.phase === "loading" ? "var(--text-dim)" : "var(--text-muted)",
              cursor: !model.id.trim() || catalogState.phase === "loading" ? "not-allowed" : "pointer",
              fontSize: "var(--text-xs)",
            }}
          >
            {catalogState.phase === "loading" ? t("models.catalogFilling") : t("models.catalogFill")}
          </button>
          <a
            href="https://github.com/anomalyco/models.dev"
            target="_blank"
            rel="noreferrer"
            style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: "var(--text-xs)", textDecoration: "none" }}
          >
            {t("models.catalogSource")}
          </a>
        </div>

        <div
          aria-live="polite"
          style={{
            marginTop: 6, height: 20, display: "flex", alignItems: "center",
            justifyContent: "space-between", gap: 8, color: catalogStatusColor, fontSize: "var(--text-xs)",
          }}
        >
          <span
            title={catalogStatusText ?? undefined}
            style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {catalogState.phase === "error" ? <ModelErrorText value={catalogStatusText ?? ""} /> : catalogStatusText}
          </span>
          {catalogUndoRef.current && (
            <button
              onClick={undoCatalogFill}
              style={{ flexShrink: 0, padding: "0 2px", border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--text-xs)" }}
            >
              {t("models.catalogUndo")}
            </button>
          )}
        </div>
      </div>

      <ModelLimitFields providerName={providerName} provider={provider} model={model} onChange={onChange} />

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Check label={t("models.form.imageInput")} checked={model.input?.includes("image") ?? false}
          onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
        <Check label={t("models.form.reasoning")} checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
      </div>
      <p style={{ margin: "-8px 0 0", color: "var(--text-dim)", fontSize: "var(--text-xs)", lineHeight: 1.5 }}>
        {t("models.form.customImageHint")}
      </p>

      <details style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: "var(--text-sm)", fontWeight: 600 }}>{t("models.advancedSettings")}</summary>
        <div style={{ paddingTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label={t("models.form.apiOverride")}>
            <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
          </Field>

          <ModelSamplingEditor providerName={providerName} provider={provider} model={model} onChange={onChange} />

          {model.reasoning && (
            <>
              <Check
                label={t("models.form.deepseek")}
                checked={hasDeepseekCompat(model)}
                onChange={(v) => onChange(setDeepseekCompat(model, v))}
              />
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <SectionTitle>{t("models.form.thinkingMap")}</SectionTitle>
                  {model.thinkingLevelMap && (
                    <button
                      onClick={() => set("thinkingLevelMap", undefined)}
                      style={{ fontSize: "var(--text-xs)", padding: "2px 7px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer" }}
                    >
                      {t("i18n.clearAll")}
                    </button>
                  )}
                </div>
                <ThinkingLevelMapEditor
                  value={model.thinkingLevelMap}
                  onChange={(v) => set("thinkingLevelMap", v)}
                />
              </div>
            </>
          )}

          {(model.api ?? provider.api ?? "openai-completions") === "openai-completions" && (
            <div>
              <SectionTitle>{t("models.compatSection")}</SectionTitle>
              <div style={{ marginTop: 8 }}>
                <CompatOverridesEditor
                  compat={model.compat}
                  inherited={provider.compat}
                  onChange={(compat) => set("compat", compat)}
                />
              </div>
            </div>
          )}

          <div>
            <SectionTitle>{t("models.form.cost")}</SectionTitle>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
              {(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => (
                <Field key={k} label={t(`models.form.cost.${k}`)}>
                  <NumInput value={costVal(k)} onChange={(v) => setCost(k, v)} placeholder="0" />
                </Field>
              ))}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
