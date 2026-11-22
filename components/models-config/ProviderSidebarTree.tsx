"use client";

import { useState, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { modelLimitProblem } from "@/lib/model-limits";
import { AliIcon } from "../AliIcon";
import { requestConfirmation } from "../ConfirmDialog";
import { ModelProviderIcon } from "../ModelProviderIcon";
import styles from "../ModelsConfig.module.css";
import type {
  ApiKeyProvider,
  ConfiguredModelRef,
  ModelEntry,
  ModelScopeResponse,
  OAuthProvider,
  ProviderEntry,
  Selection,
} from "./types";

export interface ProviderSidebarTreeProps {
  isMobile: boolean;
  loading: boolean;
  saving: boolean;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  onOpenPicker: () => void;
  activeApiKey: ApiKeyProvider[];
  activeOAuth: OAuthProvider[];
  scopeOnlyProviderIds: string[];
  providers: [string, ProviderEntry][];
  modelScope: ModelScopeResponse | null;
  persistedModelTargets: WeakMap<ModelEntry, ConfiguredModelRef>;
  renderRemoveManagedProvider: (id: string, name: string) => React.ReactNode;
  onReorderProviders: (source: string, target: string) => void;
  deleteProvider: (name: string) => void;
  onAddModel: (providerName: string) => void;
  removeModel: (providerName: string, index: number) => void;
}

export function ProviderSidebarTree({
  isMobile,
  loading,
  saving,
  selection,
  onSelect,
  onOpenPicker,
  activeApiKey,
  activeOAuth,
  scopeOnlyProviderIds,
  providers,
  modelScope,
  persistedModelTargets,
  renderRemoveManagedProvider,
  onReorderProviders,
  deleteProvider,
  onAddModel,
  removeModel,
}: ProviderSidebarTreeProps) {
  const { t } = useI18n();
  const [draggingProvider, setDraggingProvider] = useState<string | null>(null);
  const [dropTargetProvider, setDropTargetProvider] = useState<string | null>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(() => new Set());
  const providerTreeRef = useRef<HTMLDivElement>(null);

  return (
    <div className={styles.sidebar} style={{
      width: isMobile ? "100%" : 210,
      maxHeight: isMobile ? "40vh" : undefined,
      borderRight: isMobile ? "none" : "1px solid var(--border)",
      borderBottom: isMobile ? "1px solid var(--border)" : "none",
      display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--bg-panel)",
    }}>
      <div className={styles.sidebarHeading}><span>{t("models.ui.providers")}</span><button className={styles.addChannel} onClick={onOpenPicker}><AliIcon name="plus" size={13} />{t("models.ui.addProvider")}</button></div>
      <div ref={providerTreeRef} className={styles.tree} style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
        <div
          onClick={() => onSelect({ type: "vision-agent" })}
          style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 8px", marginBottom: 6, borderRadius: "var(--radius-control)", cursor: "pointer", background: selection?.type === "vision-agent" ? "var(--bg-selected)" : "none" }}
          onMouseEnter={(event) => { if (selection?.type !== "vision-agent") event.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(event) => { if (selection?.type !== "vision-agent") event.currentTarget.style.background = "none"; }}
        >
          <AliIcon name="eye" size={16} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text)", fontWeight: selection?.type === "vision-agent" ? 600 : 400 }}>{t("models.ui.vision")}</span>
        </div>
        <div style={{ margin: "0 8px 6px", borderTop: "1px solid var(--border)" }} />

        {activeApiKey.map((p) => {
          const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
          const scopedModels = (modelScope?.models ?? []).filter((model) => model.provider === p.id);
          const visibleModels = scopedModels.filter((model) => model.enabled).length;
          return (
            <div
              key={p.id}
              onClick={() => onSelect({ type: "apikey", providerId: p.id })}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: "var(--radius-control)", cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
            >
              <ModelProviderIcon provider={p.id} size={16} />
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</span>
              {scopedModels.length > 0 && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>{visibleModels}/{scopedModels.length}</span>}
              {renderRemoveManagedProvider(p.id, p.displayName)}
            </div>
          );
        })}

        {activeOAuth.map((p) => {
          const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
          const scopedModels = (modelScope?.models ?? []).filter((model) => model.provider === p.id);
          const visibleModels = scopedModels.filter((model) => model.enabled).length;
          return (
            <div
              key={p.id}
              onClick={() => onSelect({ type: "oauth", providerId: p.id })}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: "var(--radius-control)", cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
            >
              <ModelProviderIcon provider={p.id} size={16} />
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
              {scopedModels.length > 0 && <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>{visibleModels}/{scopedModels.length}</span>}
              {renderRemoveManagedProvider(p.id, p.name)}
            </div>
          );
        })}

        {scopeOnlyProviderIds.map((providerId) => {
          const isSelected = selection?.type === "managed" && selection.providerId === providerId;
          const scopedModels = (modelScope?.models ?? []).filter((model) => model.provider === providerId);
          const visibleModels = scopedModels.filter((model) => model.enabled).length;
          return (
            <div
              key={providerId}
              onClick={() => onSelect({ type: "managed", providerId })}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: "var(--radius-control)", cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
              onMouseEnter={(event) => { if (!isSelected) event.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(event) => { if (!isSelected) event.currentTarget.style.background = "none"; }}
            >
              <ModelProviderIcon provider={providerId} size={16} />
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{providerId}</span>
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>{visibleModels}/{scopedModels.length}</span>
              {renderRemoveManagedProvider(providerId, providerId)}
            </div>
          );
        })}

        {(activeOAuth.length > 0 || activeApiKey.length > 0 || scopeOnlyProviderIds.length > 0) && providers.length > 0 && (
          <div style={{ margin: "4px 8px", borderTop: "1px solid var(--border)" }} />
        )}

        {loading ? (
          <div style={{ padding: "10px 8px", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("i18n.loading")}</div>
        ) : providers.map(([pName, pData]) => {
          const isProviderSelected = selection?.type === "provider" && selection.name === pName;
          const models = pData.models ?? [];
          return (
            <div key={pName} className={styles.providerGroup} style={{ marginBottom: 2 }}>
              <div
                className={styles.providerRow} data-selected={isProviderSelected}
                draggable={!saving}
                onClick={() => onSelect({ type: "provider", name: pName })}
                onDragStart={(event) => {
                  if (saving) { event.preventDefault(); return; }
                  setDraggingProvider(pName);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", pName);
                }}
                onDragOver={(event) => {
                  if (draggingProvider && draggingProvider !== pName) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTargetProvider(pName);
                    const tree = providerTreeRef.current;
                    if (tree) {
                      const rect = tree.getBoundingClientRect();
                      const edge = 42;
                      const distance = event.clientY < rect.top + edge ? event.clientY - (rect.top + edge) : event.clientY > rect.bottom - edge ? event.clientY - (rect.bottom - edge) : 0;
                      if (distance) tree.scrollTop += Math.sign(distance) * Math.max(2, Math.min(14, Math.abs(distance) / 3));
                    }
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const source = draggingProvider ?? event.dataTransfer.getData("text/plain");
                  if (source) onReorderProviders(source, pName);
                  setDraggingProvider(null);
                  setDropTargetProvider(null);
                }}
                onDragEnd={() => { setDraggingProvider(null); setDropTargetProvider(null); }}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderRadius: "var(--radius-control)", cursor: saving ? "default" : draggingProvider === pName ? "grabbing" : "grab", opacity: draggingProvider === pName ? 0.55 : 1, background: dropTargetProvider === pName ? "var(--accent-subtle)" : isProviderSelected ? "var(--bg-selected)" : "none", transform: dropTargetProvider === pName ? "translateY(2px)" : "none", transition: "background .15s, transform .15s, opacity .15s" }}
                onMouseEnter={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "none"; }}
              >
                <AliIcon name="api" size={11} style={{ color: "var(--text-dim)" }} />
                <span style={{ fontSize: "var(--text-sm)", fontWeight: isProviderSelected ? 600 : 400, color: "var(--text)", fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pName}
                </span>
                <button type="button" aria-label={collapsedProviders.has(pName) ? "展开模型" : "折叠模型"} title={collapsedProviders.has(pName) ? "展开模型" : "折叠模型"} onClick={(e) => { e.stopPropagation(); setCollapsedProviders((current) => { const next = new Set(current); if (next.has(pName)) next.delete(pName); else next.add(pName); return next; }); }} style={{ flexShrink: 0, border: 0, background: "transparent", color: "var(--text-dim)", cursor: "pointer", padding: 2, lineHeight: 1 }}>
                  <AliIcon name="chevron-right" size={14} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--text-dim)", transform: collapsedProviders.has(pName) ? "none" : "rotate(90deg)", transition: "transform 0.15s" }} />
                </button>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (await requestConfirmation({ title: t("i18n.delete"), message: t("models.deleteProviderConfirm", { name: pName }), confirmLabel: t("i18n.delete"), tone: "danger" })) deleteProvider(pName);
                  }}
                  title={t("i18n.delete")}
                  aria-label={t("i18n.delete")}
                  style={{
                    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    width: 18, height: 18, padding: 0, border: "none", borderRadius: 4,
                    background: "transparent", color: "var(--text-dim)", cursor: "pointer",
                    opacity: 0.55, transition: "opacity 0.12s, color 0.12s, background 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "1";
                    e.currentTarget.style.color = "#ef4444";
                    e.currentTarget.style.background = "rgba(239,68,68,0.1)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "0.55";
                    e.currentTarget.style.color = "var(--text-dim)";
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <AliIcon name="delete" size={11} />
                </button>
              </div>

              {!collapsedProviders.has(pName) && models.map((m, i) => {
                const isModelSelected = selection?.type === "model" && selection.providerName === pName && selection.index === i;
                return (
                  <div
                    key={i}
                    className={styles.modelTreeRow}
                    onClick={() => onSelect({ type: "model", providerName: pName, index: i })}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 26px", borderRadius: "var(--radius-control)", cursor: "pointer", background: isModelSelected ? "var(--bg-selected)" : "none" }}
                    onMouseEnter={(e) => { if (!isModelSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isModelSelected) e.currentTarget.style.background = "none"; }}
                  >
                    <span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", color: m.id ? "var(--text-muted)" : "var(--text-dim)", flex: "0 1 auto", maxWidth: "calc(100% - 52px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.id || t("i18n.newModel")}
                    </span>
                    {m.id.trim() && modelLimitProblem(m) && (
                      <span data-model-limits-missing title={t("models.limits.missingDot")} aria-label={t("models.limits.missingDot")} style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", flexShrink: 0 }} />
                    )}
                    {modelScope?.effectiveDefault?.provider === pName && modelScope.effectiveDefault.modelId === m.id && (
                      <span className={styles.defaultBadge}>{t("models.defaultBadge")}</span>
                    )}
                    <span style={{ flex: 1 }} />
                    {m.reasoning && (
                      <span style={{ fontSize: "var(--text-xs)", padding: "1px 4px", background: "rgba(99,102,241,0.12)", color: "rgba(99,102,241,0.8)", borderRadius: 3, flexShrink: 0 }}>T</span>
                    )}
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!persistedModelTargets.has(m)) { removeModel(pName, i); return; }
                        const label = m.id || t("i18n.newModel");
                        if (await requestConfirmation({ title: t("i18n.delete"), message: t("models.deleteModelConfirm", { id: label }), confirmLabel: t("i18n.delete"), tone: "danger" })) removeModel(pName, i);
                      }}
                      title={t("i18n.delete")}
                      aria-label={t("i18n.delete")}
                      style={{
                        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                        width: 18, height: 18, padding: 0, border: "none", borderRadius: 4,
                        background: "transparent", color: "var(--text-dim)", cursor: "pointer",
                        opacity: 0.55, transition: "opacity 0.12s, color 0.12s, background 0.12s",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = "1";
                        e.currentTarget.style.color = "#ef4444";
                        e.currentTarget.style.background = "rgba(239,68,68,0.1)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = "0.55";
                        e.currentTarget.style.color = "var(--text-dim)";
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <AliIcon name="delete" size={11} />
                    </button>
                  </div>
                );
              })}

              {!collapsedProviders.has(pName) && <div
                onClick={(e) => { e.stopPropagation(); onAddModel(pName); }}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px 4px 26px", borderRadius: "var(--radius-control)", cursor: "pointer", color: "var(--text-dim)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
              >
                <span style={{ fontSize: "var(--text-xs)" }}>+ {t("i18n.model")}</span>
              </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
