"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { usePredictionSettings } from "@/hooks/useInputPrediction";
import { defaultPredictionSettings, readPredictionSettings, savePredictionSettings } from "@/lib/input-prediction";
import { fetchModelCatalog, type ModelCatalogEntry } from "@/lib/model-catalog-client";
import { SettingsModal, SettingsRow, SettingsSwitch } from "./SettingsPrimitives";
import styles from "./SettingsPrimitives.module.css";

const modelValue = (model: { provider: string; modelId: string }) => JSON.stringify([model.provider, model.modelId]);

export function InputPredictionSettings({ cwd }: { cwd?: string }) {
  const { t } = useI18n();
  const saved = usePredictionSettings(cwd);
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState(false);
  const [draft, setDraft] = useState(defaultPredictionSettings);
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const scope = project ? cwd : undefined;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setModels([]);
    setCatalogFailed(false);
    void fetchModelCatalog({ cwd: scope, signal: controller.signal }).then(catalog => {
      if (!controller.signal.aborted) setModels(catalog.modelList ?? []);
    }).catch(() => {
      if (!controller.signal.aborted) setCatalogFailed(true);
    });
    return () => controller.abort();
  }, [open, scope]);

  function editScope(nextProject: boolean) {
    setProject(nextProject);
    setDraft(readPredictionSettings(nextProject ? cwd : undefined));
    setSaveFailed(false);
  }

  function persist(useGlobal = false) {
    try {
      savePredictionSettings(useGlobal ? null : draft, scope);
      setOpen(false);
    } catch {
      setSaveFailed(true);
    }
  }

  const title = t("prediction.title");
  const description = t("prediction.description");
  const selected = draft.model ? modelValue(draft.model) : "";
  const validTimeout = Number.isInteger(draft.timeoutMs) && draft.timeoutMs >= 5_000 && draft.timeoutMs <= 120_000;
  return (
    <>
      <SettingsRow
        title={title}
        description={description}
        badge={t(saved.enabled && saved.model ? "settings.portability.enabled" : "settings.portability.disabled")}
        settingsId="conversation.inputPrediction"
      >
        <button type="button" className={styles.button} onClick={() => { editScope(false); setOpen(true); }}>
          {t("prediction.configure")}
        </button>
      </SettingsRow>
      <SettingsModal
        open={open}
        title={title}
        description={description}
        closeLabel={t("settings.closeAction")}
        onClose={() => setOpen(false)}
        footer={
          <>
            {project && cwd ? (
              <button type="button" className={styles.button} onClick={() => persist(true)}>{t("prediction.useGlobal")}</button>
            ) : <span />}
            <button type="button" className={styles.buttonPrimary} disabled={!validTimeout || (draft.enabled && !draft.model)}
              onClick={() => persist()}>{t("prediction.save")}</button>
          </>
        }
      >
        {cwd && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t("prediction.scope")}</span>
            <select className={styles.select} value={project ? "project" : "global"}
              onChange={event => editScope(event.target.value === "project")}>
              <option value="global">{t("prediction.global")}</option>
              <option value="project">{t("prediction.project")}</option>
            </select>
          </label>
        )}
        <SettingsRow title={t("prediction.enable")}>
          <SettingsSwitch checked={draft.enabled} label={t("prediction.enable")}
            onToggle={() => setDraft(current => ({ ...current, enabled: !current.enabled }))} />
        </SettingsRow>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("prediction.model")}</span>
          <select className={styles.select} value={selected} onChange={event => {
            const match = models.find(model => modelValue({ provider: model.provider, modelId: model.id }) === event.target.value);
            setDraft(current => ({ ...current, model: match ? { provider: match.provider, modelId: match.id } : null }));
          }}>
            <option value="">{t("prediction.chooseModel")}</option>
            {selected && draft.model && !models.some(model => model.provider === draft.model?.provider && model.id === draft.model?.modelId) && (
              <option value={selected}>{draft.model.provider} / {draft.model.modelId}</option>
            )}
            {models.map(model => {
              const value = modelValue({ provider: model.provider, modelId: model.id });
              return <option key={value} value={value}>{model.provider} / {model.name}</option>;
            })}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("prediction.timeout")}</span>
          <input className={styles.input} type="number" min={5} max={120} step="0.001" value={draft.timeoutMs / 1000}
            onChange={event => {
              const timeoutMs = Math.round(Number(event.target.value) * 1_000);
              setDraft(current => ({ ...current, timeoutMs }));
            }} />
        </label>
        {catalogFailed && <p role="status" className={styles.fieldHint}>{t("prediction.catalogUnavailable")}</p>}
        {saveFailed && <p role="alert" className={styles.fieldHint}>{t("prediction.saveFailed")}</p>}
      </SettingsModal>
    </>
  );
}
