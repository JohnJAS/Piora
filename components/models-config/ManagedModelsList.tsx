"use client";

import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "../AliIcon";
import { requestConfirmation } from "../ConfirmDialog";
import { ModelErrorText } from "../ModelErrorText";
import styles from "../ModelsConfig.module.css";
import { SectionTitle } from "./FormFields";
import type { ManagedModel, ModelScopeResponse, ModelsJson, ModelTestState } from "./types";

export interface ManagedModelsListProps {
  providerId: string;
  config: ModelsJson;
  modelScope: ModelScopeResponse | null;
  modelScopeLoading: boolean;
  modelScopeError: string | null;
  modelScopeBusyKey: string | null;
  managedModelTests: Record<string, ModelTestState>;
  modelImageInput: Record<string, boolean>;
  modelCapabilityBusyKey: string | null;
  updateModelScope: (
    action: "hide" | "restore" | "hide-provider" | "restore-provider" | "restore-all",
    target?: { provider: string; id?: string },
  ) => Promise<boolean>;
  onUpdateModelImageInput: (model: ManagedModel, imageInput: boolean) => Promise<void>;
  onTestManagedModel: (model: ManagedModel) => Promise<void>;
  removeModel: (providerName: string, index: number) => void;
}

export function ManagedModelsList({
  providerId,
  config,
  modelScope,
  modelScopeLoading,
  modelScopeError,
  modelScopeBusyKey,
  managedModelTests,
  modelImageInput,
  modelCapabilityBusyKey,
  updateModelScope,
  onUpdateModelImageInput,
  onTestManagedModel,
  removeModel,
}: ManagedModelsListProps) {
  const { t } = useI18n();
  const allProviderModels = (modelScope?.models ?? []).filter((model) => model.provider === providerId);
  const customModelIds = new Set((config.providers?.[providerId]?.models ?? []).map((entry) => entry.id));
  // Deleting a model removes it from this table instead of leaving a greyed-out
  // "hidden" row behind. Custom models stay listed even while Pi's scope disables
  // them, so they can still be deleted from ~/.pi/agent/models.json.
  const providerModels = allProviderModels.filter((model) => model.enabled || customModelIds.has(model.id));
  const visibleCount = allProviderModels.filter((model) => model.enabled).length;
  const hiddenCount = allProviderModels.length - visibleCount;
  const restoreAllBusy = modelScopeBusyKey === "restore-all";
  const hideProviderBusy = modelScopeBusyKey === `hide-provider:${providerId}`;
  const scopeMutationBusy = modelScopeBusyKey !== null;

  return (
    <div className={styles.modelsCard} style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <SectionTitle>{t("models.availableModels")}</SectionTitle>
        {!modelScopeLoading && allProviderModels.length > 0 && (
          <span style={{ marginLeft: "auto", fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
            {t("models.visibleCount", { visible: visibleCount, total: allProviderModels.length })}
          </span>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            disabled={scopeMutationBusy || modelScope?.projectOverride}
            onClick={() => void updateModelScope("restore-all")}
            style={{
              padding: "4px 8px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: scopeMutationBusy || modelScope?.projectOverride ? "not-allowed" : "pointer",
              fontSize: "var(--text-xs)",
              opacity: scopeMutationBusy || modelScope?.projectOverride ? 0.55 : 1,
            }}
          >
            {restoreAllBusy ? t("i18n.saving") : t("models.restoreAll")}
          </button>
        )}
        {visibleCount > 0 && (
          <button
            type="button"
            disabled={scopeMutationBusy || modelScope?.projectOverride}
            onClick={async () => {
              if (!await requestConfirmation({ title: t("models.hideProvider"), message: t("models.hideProviderConfirm", { name: providerId }), confirmLabel: t("models.hideProvider") })) return;
              void updateModelScope("hide-provider", { provider: providerId });
            }}
            style={{
              padding: "4px 8px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: scopeMutationBusy || modelScope?.projectOverride ? "not-allowed" : "pointer",
              fontSize: "var(--text-xs)",
              opacity: scopeMutationBusy || modelScope?.projectOverride ? 0.55 : 1,
            }}
          >
            {hideProviderBusy ? t("i18n.saving") : t("models.hideProvider")}
          </button>
        )}
      </div>

      {modelScopeError && modelScope && (
        <div role="alert" style={{ padding: "9px 10px", borderRadius: "var(--radius-control)", background: "rgba(239,68,68,0.08)", color: "#dc2626", fontSize: "var(--text-sm)" }}>
          {<ModelErrorText value={modelScopeError} />}
        </div>
      )}

      {modelScope && modelScope.warnings.length > 0 && (
        <div role="note" style={{ padding: "9px 10px", borderRadius: "var(--radius-control)", background: "rgba(245,158,11,0.09)", color: "#b45309", fontSize: "var(--text-xs)", lineHeight: 1.5 }}>
          {modelScope.warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      )}

      {modelScopeLoading ? (
        <div style={{ padding: "12px 0", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{t("i18n.loading")}</div>
      ) : modelScopeError && !modelScope ? (
        <div role="alert" style={{ padding: "9px 10px", borderRadius: "var(--radius-control)", background: "rgba(239,68,68,0.08)", color: "#dc2626", fontSize: "var(--text-sm)" }}>
          {<ModelErrorText value={modelScopeError} />}
        </div>
      ) : providerModels.length === 0 ? (
        <div style={{ padding: "12px 0", fontSize: "var(--text-sm)", color: "var(--text-dim)" }}>
          {allProviderModels.length === 0 ? t("models.noProviderModels") : t("models.allModelsDeleted")}
        </div>
      ) : (
        <div className={styles.modelTable} style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", overflow: "hidden" }}>
          <div className={styles.tableHeader}><span>{t("models.form.modelName")}</span><span>{t("models.form.imageInput")}</span><span>{t("i18n.test")}</span><span>{t("models.ui.actions")}</span></div>
          {providerModels.map((model, index) => {
            const customIndex = config.providers?.[providerId]?.models?.findIndex(entry => entry.id === model.id) ?? -1;
            const testKey = `${model.provider}/${model.id}`;
            const testState = managedModelTests[testKey] ?? { phase: "idle" };
            const testMeta = testState.phase === "success" || testState.phase === "error"
              ? [
                  testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
                  testState.status !== undefined ? `HTTP ${testState.status}` : null,
                ].filter(Boolean)
              : [];
            const testSummary = testState.phase === "testing"
              ? t("i18n.testingModel")
              : testState.phase === "success"
                ? [t("models.testAvailable"), ...testMeta, testState.responseText || null].filter(Boolean).join(" · ")
                : testState.phase === "error"
                  ? [t("models.testUnavailable"), ...testMeta, testState.message].filter(Boolean).join(" · ")
                  : null;
            return (
              <div
                key={`${model.provider}/${model.id}`}
                className={styles.modelDataRow}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  minHeight: 42,
                  padding: "7px 9px",
                  borderTop: index === 0 ? "none" : "1px solid var(--border)",
                  background: model.enabled ? "var(--bg)" : "var(--bg-panel)",
                  opacity: model.enabled ? 1 : 0.68,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: model.enabled ? "#22c55e" : "var(--text-dim)" }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: "var(--text-sm)", fontWeight: 500 }}>
                      {model.name || model.id}
                    </span>
                  </span>
                  <code style={{ display: "block", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
                    {model.id}
                  </code>
                  {testSummary && (
                    <span
                      role={testState.phase === "error" ? "alert" : "status"}
                      aria-live="polite"
                      title={testSummary}
                      style={{
                        display: "block",
                        marginTop: 3,
                        color: testState.phase === "error"
                          ? "#dc2626"
                          : testState.phase === "success"
                            ? "#15803d"
                            : "var(--text-dim)",
                        fontSize: "var(--text-xs)",
                        lineHeight: 1.35,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {testState.phase === "error" ? <ModelErrorText value={testSummary} /> : testSummary}
                    </span>
                  )}
                </span>
                <label title={t("models.form.imageHint")} style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 5, color: "var(--text-muted)", fontSize: "var(--text-xs)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={modelImageInput[testKey] ?? false}
                    disabled={modelCapabilityBusyKey === testKey}
                    onChange={(event) => void onUpdateModelImageInput(model, event.target.checked)}
                    style={{ width: 13, height: 13, accentColor: "var(--accent)" }}
                  />
                  {t("models.form.imageSupport")}
                </label>
                <button
                  type="button"
                  data-model-test={testKey}
                  disabled={testState.phase === "testing"}
                  onClick={() => void onTestManagedModel(model)}
                  title={`${t("i18n.testConnection")}: ${model.name || model.id}`}
                  aria-label={`${t("i18n.testConnection")}: ${model.name || model.id}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    minWidth: 52,
                    minHeight: "max(28px, calc(var(--text-xs) + 12px))",
                    padding: "4px 9px",
                    border: `1px solid ${testState.phase === "error"
                      ? "rgba(220,38,38,0.3)"
                      : testState.phase === "success"
                        ? "rgba(21,128,61,0.3)"
                        : "var(--border)"}`,
                    borderRadius: "var(--radius-control)",
                    background: testState.phase === "error"
                      ? "rgba(220,38,38,0.07)"
                      : testState.phase === "success"
                        ? "rgba(21,128,61,0.08)"
                        : "var(--bg-panel)",
                    color: testState.phase === "error"
                      ? "#dc2626"
                      : testState.phase === "success"
                        ? "#15803d"
                        : "var(--text-muted)",
                    cursor: testState.phase === "testing" ? "wait" : "pointer",
                    opacity: testState.phase === "testing" ? 0.68 : 1,
                    fontSize: "var(--text-xs)",
                    fontWeight: 550,
                    whiteSpace: "nowrap",
                  }}
                >
                  {testState.phase === "success" && <AliIcon name="check" size={12} />}
                  {testState.phase === "testing"
                    ? t("i18n.checking")
                    : testState.phase === "idle"
                      ? t("i18n.test")
                      : t("models.testAgain")}
                </button>
                <button
                  type="button"
                  disabled={scopeMutationBusy || (customIndex < 0 && modelScope?.projectOverride)}
                  onClick={async () => {
                    if (customIndex >= 0) {
                      if (await requestConfirmation({ title: t("i18n.delete"), message: t("models.deleteModelConfirm", { id: model.id }), confirmLabel: t("i18n.delete"), tone: "danger" })) removeModel(providerId, customIndex);
                      return;
                    }
                    if (!await requestConfirmation({ title: t("models.deleteManagedModel"), message: t("models.deleteManagedModelConfirm", { id: model.name || model.id }), confirmLabel: t("i18n.delete"), tone: "danger" })) return;
                    void updateModelScope("hide", model);
                  }}
                  title={customIndex >= 0 ? t("i18n.delete") : t("models.deleteManagedModel")}
                  aria-label={customIndex >= 0 ? t("i18n.delete") : t("models.deleteManagedModel")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    padding: 0,
                    border: "none",
                    borderRadius: "var(--radius-control)",
                    background: "transparent",
                    color: "#ef4444",
                    cursor: scopeMutationBusy || modelScope?.projectOverride ? "not-allowed" : "pointer",
                    opacity: scopeMutationBusy || modelScope?.projectOverride ? 0.45 : 0.82,
                  }}
                >
                  <AliIcon name="delete" size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {modelScope?.projectOverride && (
        <div role="note" style={{ fontSize: "var(--text-xs)", lineHeight: 1.5, color: "#b45309" }}>
          {t("models.projectScopeOverride")}
        </div>
      )}
      <details className={styles.modelGuide}><summary>{t("models.ui.usageHelp")}</summary><p>{t("models.scopeChangeHint")}</p></details>
    </div>
  );
}
