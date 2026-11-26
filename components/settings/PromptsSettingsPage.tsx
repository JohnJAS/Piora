"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH, PROMPT_OPTIMIZER_SYSTEM_PROMPT } from "@/lib/prompt-optimizer";
import {
  readPromptOptimizerModel,
  readPromptOptimizerSystemPrompt,
  resetPromptOptimizerSystemPrompt,
  writePromptOptimizerModel,
  writePromptOptimizerSystemPrompt,
} from "@/lib/prompt-optimizer-settings";
import { SESSION_TITLE_PROMPT_MAX_LENGTH } from "@/lib/session-title-prompt";
import {
  SESSION_TITLE_PROMPT,
  readSessionTitleModel,
  readSessionTitlePrompt,
  resetSessionTitleModel,
  resetSessionTitlePrompt,
  writeSessionTitleModel,
  writeSessionTitlePrompt,
  type SessionTitleModelPreference,
} from "@/lib/session-title-settings";
import { RuntimePromptSettings } from "../RuntimePromptSettings";
import { SystemPromptEditor } from "../SystemPromptEditor";
import {
  SettingsModal,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "./SettingsPrimitives";
import primitiveStyles from "./SettingsPrimitives.module.css";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

interface Props {
  open: boolean;
  modelCwd?: string;
  systemPrompt: string | null;
  onSystemPromptSaved: () => void;
}

function modelPreferenceValue(model: SessionTitleModelPreference): string {
  return JSON.stringify(model);
}

export function PromptsSettingsPage({ open, modelCwd, systemPrompt, onSystemPromptSaved }: Props) {
  const { t } = useI18n();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [systemModalOpen, setSystemModalOpen] = useState(false);
  const [optimizerModalOpen, setOptimizerModalOpen] = useState(false);
  const [titleModalOpen, setTitleModalOpen] = useState(false);

  const [optimizerPromptDraft, setOptimizerPromptDraft] = useState(PROMPT_OPTIMIZER_SYSTEM_PROMPT);
  const [optimizerPromptSaved, setOptimizerPromptSaved] = useState(PROMPT_OPTIMIZER_SYSTEM_PROMPT);
  const [optimizerPromptStatus, setOptimizerPromptStatus] = useState<"idle" | "saved" | "error">("idle");
  const [optimizerModelValue, setOptimizerModelValue] = useState("");

  const [titlePromptDraft, setTitlePromptDraft] = useState(SESSION_TITLE_PROMPT);
  const [titlePromptSaved, setTitlePromptSaved] = useState(SESSION_TITLE_PROMPT);
  const [titlePromptStatus, setTitlePromptStatus] = useState<"idle" | "saved" | "error">("idle");
  const [titleModel, setTitleModel] = useState<SessionTitleModelPreference | null>(null);
  const [titleModelSaveError, setTitleModelSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const savedOptimizer = readPromptOptimizerSystemPrompt(window.localStorage);
    setOptimizerPromptDraft(savedOptimizer);
    setOptimizerPromptSaved(savedOptimizer);
    setOptimizerPromptStatus("idle");
    const savedOptimizerModel = readPromptOptimizerModel(window.localStorage);
    setOptimizerModelValue(savedOptimizerModel ? JSON.stringify(savedOptimizerModel) : "");

    const savedTitle = readSessionTitlePrompt(window.localStorage);
    setTitlePromptDraft(savedTitle);
    setTitlePromptSaved(savedTitle);
    setTitlePromptStatus("idle");
    setTitleModel(readSessionTitleModel(window.localStorage));
    setTitleModelSaveError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setModelsLoading(true);
    setModelsError(null);
    const query = modelCwd ? `?cwd=${encodeURIComponent(modelCwd)}` : "";
    void fetch(`/api/models${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { modelList?: ModelOption[]; error?: string };
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) setModels(body.modelList ?? []);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setModelsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setModelsLoading(false);
      });
    return () => controller.abort();
  }, [modelCwd, open]);

  const saveOptimizerPrompt = () => {
    try {
      const saved = writePromptOptimizerSystemPrompt(optimizerPromptDraft, window.localStorage);
      setOptimizerPromptDraft(saved);
      setOptimizerPromptSaved(saved);
      setOptimizerPromptStatus("saved");
    } catch {
      setOptimizerPromptStatus("error");
    }
  };

  const restoreOptimizerPrompt = () => {
    try {
      const restored = resetPromptOptimizerSystemPrompt(window.localStorage);
      setOptimizerPromptDraft(restored);
      setOptimizerPromptSaved(restored);
      setOptimizerPromptStatus("saved");
    } catch {
      setOptimizerPromptStatus("error");
    }
  };

  const saveOptimizerModel = (value: string) => {
    setOptimizerModelValue(value);
    try {
      writePromptOptimizerModel(value ? JSON.parse(value) : null, window.localStorage);
      setOptimizerPromptStatus("saved");
    } catch {
      setOptimizerPromptStatus("error");
    }
  };

  const saveTitlePrompt = () => {
    try {
      const saved = writeSessionTitlePrompt(titlePromptDraft, window.localStorage);
      setTitlePromptDraft(saved);
      setTitlePromptSaved(saved);
      setTitlePromptStatus("saved");
    } catch {
      setTitlePromptStatus("error");
    }
  };

  const restoreTitlePrompt = () => {
    try {
      const restored = resetSessionTitlePrompt(window.localStorage);
      setTitlePromptDraft(restored);
      setTitlePromptSaved(restored);
      setTitlePromptStatus("saved");
    } catch {
      setTitlePromptStatus("error");
    }
  };

  const selectTitleModel = (value: string) => {
    setTitleModelSaveError(null);
    try {
      if (!value) {
        setTitleModel(resetSessionTitleModel(window.localStorage));
        return;
      }
      const selected = models.find((model) => modelPreferenceValue({ provider: model.provider, modelId: model.id }) === value);
      if (!selected) return;
      setTitleModel(writeSessionTitleModel({ provider: selected.provider, modelId: selected.id }, window.localStorage));
    } catch {
      setTitleModelSaveError(t("settings.sessionTitleModelSaveFailed"));
    }
  };

  const optimizerCustomized = optimizerPromptSaved.trim() !== PROMPT_OPTIMIZER_SYSTEM_PROMPT.trim();
  const titleCustomized = titlePromptSaved.trim() !== SESSION_TITLE_PROMPT.trim();
  const selectedTitleValue = titleModel ? modelPreferenceValue(titleModel) : "";
  const titleModelUnavailable = Boolean(
    titleModel
      && !modelsLoading
      && !models.some((model) => model.provider === titleModel.provider && model.id === titleModel.modelId),
  );

  return (
    <SettingsPage
      title={t("settings.page.prompts")}
      description={t("settings.page.promptsDescription")}
    >
      <SettingsSection title={t("settings.section.systemAndExtensions")}>
        <SettingsRow
          title={t("system.prompt")}
          description={t("system.description")}
          badge={systemPrompt?.trim() ? t("settings.customized") : t("settings.usingDefault")}
          settingsId="conversation.systemPrompt"
        >
          <button type="button" className={primitiveStyles.button} onClick={() => setSystemModalOpen(true)}>
            {t("settings.editAction")}
          </button>
        </SettingsRow>
      </SettingsSection>

      <RuntimePromptSettings compact />

      <SettingsSection title={t("settings.section.automationText")}>
        <SettingsRow
          title={t("settings.promptOptimizerTitle")}
          description={t("settings.promptOptimizerModelDescription")}
          badge={optimizerCustomized ? t("settings.customized") : undefined}
          settingsId="conversation.promptOptimizer"
        >
          <select
            className={primitiveStyles.select}
            aria-label={t("settings.promptOptimizerModel")}
            value={optimizerModelValue}
            onChange={(event) => saveOptimizerModel(event.target.value)}
          >
            <option value="">{t("settings.promptOptimizerModelDefault")}</option>
            {models.map((candidate) => {
              const value = JSON.stringify({ provider: candidate.provider, modelId: candidate.id });
              return <option key={`${candidate.provider}/${candidate.id}`} value={value}>{candidate.name} · {candidate.provider}</option>;
            })}
          </select>
          <button type="button" className={primitiveStyles.button} onClick={() => setOptimizerModalOpen(true)}>
            {t("settings.editAction")}
          </button>
        </SettingsRow>

        <SettingsRow
          title={t("settings.sessionTitlePromptTitle")}
          description={
            <>
              {t("settings.sessionTitleModelDescription")}
              {modelsError ? <div className={primitiveStyles.statusError}>{t("settings.sessionTitleModelsLoadFailed", { error: modelsError })}</div> : null}
              {titleModelSaveError ? <div className={primitiveStyles.statusError}>{titleModelSaveError}</div> : null}
            </>
          }
          badge={titleCustomized ? t("settings.customized") : undefined}
          settingsId="conversation.titleModel"
        >
          <select
            className={primitiveStyles.select}
            aria-label={t("settings.sessionTitleModelTitle")}
            value={selectedTitleValue}
            disabled={modelsLoading && models.length === 0}
            onChange={(event) => selectTitleModel(event.target.value)}
          >
            <option value="">{t("settings.sessionTitleModelCurrent")}</option>
            {titleModelUnavailable && titleModel ? (
              <option value={selectedTitleValue} disabled>
                {t("settings.sessionTitleModelUnavailable", { model: `${titleModel.provider}/${titleModel.modelId}` })}
              </option>
            ) : null}
            {models.map((candidate) => {
              const value = modelPreferenceValue({ provider: candidate.provider, modelId: candidate.id });
              return <option key={`${candidate.provider}/${candidate.id}`} value={value}>{candidate.name} · {candidate.provider}</option>;
            })}
          </select>
          <button type="button" className={primitiveStyles.button} onClick={() => setTitleModalOpen(true)}>
            {t("settings.editAction")}
          </button>
        </SettingsRow>
      </SettingsSection>

      <SettingsModal
        open={systemModalOpen}
        title={t("system.prompt")}
        description={t("system.description")}
        closeLabel={t("settings.closeAction")}
        onClose={() => setSystemModalOpen(false)}
      >
        <SystemPromptEditor effectivePrompt={systemPrompt} onSaved={onSystemPromptSaved} />
      </SettingsModal>

      <SettingsModal
        open={optimizerModalOpen}
        title={t("settings.promptOptimizerTitle")}
        description={t("settings.promptOptimizerDescription")}
        closeLabel={t("settings.closeAction")}
        onClose={() => setOptimizerModalOpen(false)}
        footer={
          <>
            <button type="button" className={primitiveStyles.button} onClick={restoreOptimizerPrompt}>
              {t("settings.promptOptimizerRestore")}
            </button>
            <div className={primitiveStyles.modalActions}>
              {optimizerPromptStatus === "saved" ? <span className={primitiveStyles.statusText} role="status">{t("settings.promptOptimizerSaved")}</span> : null}
              {optimizerPromptStatus === "error" ? <span className={primitiveStyles.statusError} role="status">{t("settings.promptOptimizerSaveFailed")}</span> : null}
              <button
                type="button"
                className={primitiveStyles.buttonPrimary}
                disabled={!optimizerPromptDraft.trim() || optimizerPromptDraft.trim() === optimizerPromptSaved}
                onClick={saveOptimizerPrompt}
              >
                {t("settings.promptOptimizerSave")}
              </button>
            </div>
          </>
        }
      >
        <label className={primitiveStyles.field}>
          <span className={primitiveStyles.fieldLabel}>
            {t("settings.promptOptimizerInstructionLabel")} ({Array.from(optimizerPromptDraft).length.toLocaleString()} / {PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH.toLocaleString()})
          </span>
          <span className={primitiveStyles.fieldHint}>{t("settings.promptOptimizerInstructionDescription")}</span>
          <textarea
            className={primitiveStyles.modalTextarea}
            value={optimizerPromptDraft}
            maxLength={PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH}
            aria-label={t("settings.promptOptimizerInstructionLabel")}
            onChange={(event) => {
              setOptimizerPromptDraft(event.target.value);
              setOptimizerPromptStatus("idle");
            }}
          />
        </label>
      </SettingsModal>

      <SettingsModal
        open={titleModalOpen}
        title={t("settings.sessionTitlePromptTitle")}
        description={t("settings.sessionTitlePromptDescription")}
        closeLabel={t("settings.closeAction")}
        onClose={() => setTitleModalOpen(false)}
        footer={
          <>
            <button type="button" className={primitiveStyles.button} onClick={restoreTitlePrompt}>
              {t("settings.sessionTitlePromptRestore")}
            </button>
            <div className={primitiveStyles.modalActions}>
              {titlePromptStatus === "saved" ? <span className={primitiveStyles.statusText} role="status">{t("settings.sessionTitlePromptSaved")}</span> : null}
              {titlePromptStatus === "error" ? <span className={primitiveStyles.statusError} role="status">{t("settings.sessionTitlePromptSaveFailed")}</span> : null}
              <button
                type="button"
                className={primitiveStyles.buttonPrimary}
                disabled={!titlePromptDraft.trim() || titlePromptDraft.trim() === titlePromptSaved}
                onClick={saveTitlePrompt}
              >
                {t("settings.sessionTitlePromptSave")}
              </button>
            </div>
          </>
        }
      >
        <label className={primitiveStyles.field}>
          <span className={primitiveStyles.fieldLabel}>
            {t("settings.sessionTitleInstructionLabel")} ({Array.from(titlePromptDraft).length.toLocaleString()} / {SESSION_TITLE_PROMPT_MAX_LENGTH.toLocaleString()})
          </span>
          <span className={primitiveStyles.fieldHint}>{t("settings.sessionTitleInstructionDescription")}</span>
          <textarea
            className={primitiveStyles.modalTextarea}
            value={titlePromptDraft}
            maxLength={SESSION_TITLE_PROMPT_MAX_LENGTH}
            aria-label={t("settings.sessionTitleInstructionLabel")}
            onChange={(event) => {
              setTitlePromptDraft(event.target.value);
              setTitlePromptStatus("idle");
            }}
          />
        </label>
      </SettingsModal>
    </SettingsPage>
  );
}
