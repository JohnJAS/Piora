"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useI18n } from "@/hooks/useI18n";
import type { ModelCatalogEntry } from "@/lib/model-catalog-client";
import type { SubagentProfile } from "@/lib/subagent-types";
import {
  COMMON_SUBAGENT_TOOLS,
  READONLY_SUBAGENT_TOOLS,
  SUBAGENT_PROFILE_TEMPLATES,
  type SubagentProfileTemplate,
} from "@/lib/subagents/profile-templates";
import { AliIcon } from "../AliIcon";
import css from "../SubagentSettings.module.css";

type ToolMode = "inherit" | "readonly" | "none" | "custom";

export interface ProfileEditorSubmitPayload {
  scope: "user" | "project";
  name: string;
  previousName?: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  maxTurns?: number;
  background: boolean;
}

function detectToolMode(tools?: string[]): ToolMode {
  if (tools === undefined) return "inherit";
  if (tools.length === 0) return "none";
  const sorted = [...tools].sort().join(",");
  const readonlySorted = [...READONLY_SUBAGENT_TOOLS].sort().join(",");
  return sorted === readonlySorted ? "readonly" : "custom";
}

export function SubagentProfileEditor({
  open,
  mode,
  initialProfile,
  initialTemplate,
  hasProjectScope,
  models,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  mode: "create" | "edit";
  initialProfile?: SubagentProfile;
  initialTemplate?: SubagentProfileTemplate;
  hasProjectScope: boolean;
  models: ModelCatalogEntry[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (payload: ProfileEditorSubmitPayload) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const isZh = locale.toLowerCase().startsWith("zh");
  const modalRef = useRef<HTMLDivElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  useFocusTrap(modalRef, open, { initialFocus: nameRef, onEscape: onClose });

  const [scope, setScope] = useState<"user" | "project">("user");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [toolMode, setToolMode] = useState<ToolMode>("inherit");
  const [selectedTools, setSelectedTools] = useState<string[]>([...READONLY_SUBAGENT_TOOLS]);
  const [extraTools, setExtraTools] = useState("");
  const [disallowedToolsText, setDisallowedToolsText] = useState("");
  const [model, setModel] = useState("");
  const [maxTurns, setMaxTurns] = useState(0);
  const [background, setBackground] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLocalError("");
    if (mode === "edit" && initialProfile) {
      setScope(initialProfile.source === "project" ? "project" : "user");
      setName(initialProfile.name);
      setDescription(initialProfile.description);
      const detected = detectToolMode(initialProfile.tools);
      setToolMode(detected);
      const knownNames = new Set<string>(COMMON_SUBAGENT_TOOLS.map(item => item.name));
      const baseTools = initialProfile.tools ?? [];
      setSelectedTools(baseTools.filter(item => knownNames.has(item)));
      setExtraTools(baseTools.filter(item => !knownNames.has(item)).join(", "));
      setDisallowedToolsText((initialProfile.disallowedTools ?? []).join(", "));
      setModel(initialProfile.model ?? "");
      setMaxTurns(initialProfile.maxTurns ?? 0);
      setBackground(initialProfile.background === true);
      setSystemPrompt(initialProfile.systemPrompt);
    } else if (initialTemplate) {
      setScope(hasProjectScope ? "project" : "user");
      setName(initialTemplate.name);
      setDescription(isZh ? initialTemplate.descriptionZh : initialTemplate.descriptionEn);
      const detected = detectToolMode(initialTemplate.tools);
      setToolMode(detected);
      setSelectedTools(initialTemplate.tools ? [...initialTemplate.tools] : [...READONLY_SUBAGENT_TOOLS]);
      setExtraTools("");
      setDisallowedToolsText("");
      setModel("");
      setMaxTurns(initialTemplate.maxTurns ?? 0);
      setBackground(initialTemplate.background);
      setSystemPrompt(initialTemplate.systemPrompt);
    } else {
      setScope(hasProjectScope ? "project" : "user");
      setName("");
      setDescription("");
      setToolMode("inherit");
      setSelectedTools([...READONLY_SUBAGENT_TOOLS]);
      setExtraTools("");
      setDisallowedToolsText("");
      setModel("");
      setMaxTurns(0);
      setBackground(false);
      setSystemPrompt("");
    }
  }, [open, mode, initialProfile, initialTemplate, hasProjectScope, isZh]);

  if (!open || typeof document === "undefined") return null;

  const applyTemplate = (template: SubagentProfileTemplate) => {
    setName(template.name);
    setDescription(isZh ? template.descriptionZh : template.descriptionEn);
    const detected = detectToolMode(template.tools);
    setToolMode(detected);
    setSelectedTools(template.tools ? [...template.tools] : [...READONLY_SUBAGENT_TOOLS]);
    setExtraTools("");
    setDisallowedToolsText("");
    setMaxTurns(template.maxTurns ?? 0);
    setBackground(template.background);
    setSystemPrompt(template.systemPrompt);
    setLocalError("");
  };

  const toggleTool = (toolName: string) => {
    setSelectedTools(current => (
      current.includes(toolName) ? current.filter(item => item !== toolName) : [...current, toolName]
    ));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError("");
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    const trimmedPrompt = systemPrompt.trim();
    if (!trimmedName || !trimmedDesc || !trimmedPrompt) {
      setLocalError(isZh ? "请完整填写代理标识名、职责说明与系统指令。" : "Please fill in profile name, summary, and system instructions.");
      return;
    }
    let tools: string[] | undefined;
    if (toolMode === "readonly") {
      tools = [...READONLY_SUBAGENT_TOOLS];
    } else if (toolMode === "none") {
      tools = [];
    } else if (toolMode === "custom") {
      const extras = extraTools.split(",").map(item => item.trim()).filter(Boolean);
      const merged = [...new Set([...selectedTools, ...extras])];
      if (merged.length === 0) {
        setLocalError(isZh ? "请至少选择或输入一项工具，或切换到「禁用所有工具」/「继承主代理全部工具」。" : "Select at least one tool or switch to No tools / Inherit all.");
        return;
      }
      tools = merged;
    }
    const disallowedList = [...new Set(disallowedToolsText.split(",").map(item => item.trim()).filter(Boolean))];
    const normalizedTurns = Number.isFinite(maxTurns) ? Math.max(0, Math.round(maxTurns)) : 0;
    await onSave({
      scope,
      name: trimmedName,
      previousName: mode === "edit" ? initialProfile?.name : undefined,
      description: trimmedDesc,
      systemPrompt: trimmedPrompt,
      ...(tools !== undefined ? { tools } : {}),
      ...(disallowedList.length > 0 ? { disallowedTools: disallowedList } : {}),
      model: model || undefined,
      maxTurns: normalizedTurns > 0 ? Math.min(100, normalizedTurns) : 0,
      background,
    });
  };

  const providers = [...new Set(models.map(item => item.provider))];

  return createPortal(
    <div
      className={css.modalBackdrop}
      role="presentation"
      onClick={event => { if (event.target === event.currentTarget && !saving) onClose(); }}
    >
      <div
        ref={modalRef}
        className={css.modal}
        role="dialog"
        aria-modal="true"
        aria-label={t(mode === "edit" ? "subagent.editor.editTitle" : "subagent.editor.createTitle")}
        data-testid="subagent-profile-editor"
      >
        <header className={css.modalHeader}>
          <h3 className={css.modalTitle}>
            {t(mode === "edit" ? "subagent.editor.editTitle" : "subagent.editor.createTitle")}
          </h3>
          <button
            type="button"
            className={css.ghostBtn}
            aria-label={t("subagent.editor.close")}
            disabled={saving}
            onClick={onClose}
          >
            <AliIcon name="close" size={14} />
          </button>
        </header>

        <form onSubmit={event => void handleSubmit(event)} style={{ display: "contents" }}>
          <div className={css.modalBody}>
            {mode === "create" && (
              <div className={css.formRow}>
                <span className={css.formLabel}>{t("subagent.editor.templateBar")}</span>
                <div className={css.segmented}>
                  {SUBAGENT_PROFILE_TEMPLATES.map(template => (
                    <button
                      key={template.id}
                      type="button"
                      className={css.templateChip}
                      onClick={() => applyTemplate(template)}
                    >
                      <AliIcon name="sparkles" size={12} />
                      <span>{isZh ? template.titleZh : template.titleEn}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={css.formRow}>
              <span className={css.formLabel}>{t("subagent.editor.scope")}</span>
              <div className={css.segmented}>
                <button
                  type="button"
                  className={css.segmentOption}
                  aria-pressed={scope === "user"}
                  disabled={mode === "edit" && initialProfile?.source === "project"}
                  onClick={() => setScope("user")}
                >
                  {t("subagent.editor.scopeUser")}
                </button>
                <button
                  type="button"
                  className={css.segmentOption}
                  aria-pressed={scope === "project"}
                  disabled={!hasProjectScope || (mode === "edit" && initialProfile?.source === "user")}
                  onClick={() => setScope("project")}
                >
                  {t("subagent.editor.scopeProject")}
                </button>
              </div>
            </div>

            <div className={css.formGrid2}>
              <label className={css.formRow}>
                <span className={css.formLabel}>{t("subagent.editor.name")}</span>
                <input
                  ref={nameRef}
                  type="text"
                  className={css.textInput}
                  value={name}
                  placeholder={t("subagent.editor.namePlaceholder")}
                  maxLength={64}
                  disabled={saving}
                  onChange={event => setName(event.target.value)}
                />
                <span className={css.formHelp}>{t("subagent.editor.nameHint")}</span>
              </label>

              <label className={css.formRow}>
                <span className={css.formLabel}>{t("subagent.editor.maxTurns")}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={css.textInput}
                  value={maxTurns}
                  disabled={saving}
                  onChange={event => setMaxTurns(Number(event.target.value))}
                />
                <span className={css.formHelp}>{t("subagent.editor.maxTurnsHint")}</span>
              </label>
            </div>

            <label className={css.formRow}>
              <span className={css.formLabel}>{t("subagent.editor.description")}</span>
              <input
                type="text"
                className={css.textInput}
                value={description}
                placeholder={t("subagent.editor.descriptionPlaceholder")}
                maxLength={500}
                disabled={saving}
                onChange={event => setDescription(event.target.value)}
              />
            </label>

            <div className={css.formRow}>
              <span className={css.formLabel}>{t("subagent.editor.toolMode")}</span>
              <div className={css.segmented}>
                {(["inherit", "readonly", "none", "custom"] as const).map(option => (
                  <button
                    key={option}
                    type="button"
                    className={css.segmentOption}
                    aria-pressed={toolMode === option}
                    onClick={() => setToolMode(option)}
                  >
                    {t(
                      option === "inherit"
                        ? "subagent.editor.toolModeInherit"
                        : option === "readonly"
                          ? "subagent.editor.toolModeReadOnly"
                          : option === "none"
                            ? "subagent.editor.toolModeNone"
                            : "subagent.editor.toolModeCustom",
                    )}
                  </button>
                ))}
              </div>
              {toolMode === "custom" && (
                <>
                  <div className={css.toolChips}>
                    {COMMON_SUBAGENT_TOOLS.map(tool => (
                      <button
                        key={tool.name}
                        type="button"
                        className={css.toolChip}
                        aria-pressed={selectedTools.includes(tool.name)}
                        onClick={() => toggleTool(tool.name)}
                      >
                        <span>{tool.name}</span>
                        <span>· {isZh ? tool.labelZh : tool.labelEn}</span>
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    className={css.textInput}
                    value={extraTools}
                    placeholder={t("subagent.editor.customToolsPlaceholder")}
                    disabled={saving}
                    onChange={event => setExtraTools(event.target.value)}
                  />
                </>
              )}
              <label className={css.formRow} style={{ marginTop: 6 }}>
                <span className={css.formLabel}>{t("subagent.editor.disallowedTools")}</span>
                <input
                  type="text"
                  className={css.textInput}
                  value={disallowedToolsText}
                  placeholder={t("subagent.editor.disallowedToolsPlaceholder")}
                  disabled={saving}
                  onChange={event => setDisallowedToolsText(event.target.value)}
                />
              </label>
            </div>

            <div className={css.formGrid2}>
              <label className={css.formRow}>
                <span className={css.formLabel}>{t("subagent.editor.model")}</span>
                <select
                  className={css.modelSelect}
                  value={model}
                  disabled={saving}
                  onChange={event => setModel(event.target.value)}
                >
                  <option value="">{t("subagent.inheritModel")}</option>
                  {model && !models.some(item => `${item.provider}/${item.id}` === model) && (
                    <option value={model}>{model}</option>
                  )}
                  {providers.map(provider => (
                    <optgroup key={provider} label={provider}>
                      {models.filter(item => item.provider === provider).map(item => (
                        <option key={item.id} value={`${provider}/${item.id}`}>
                          {(item.name || item.id)} · {provider}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <div className={css.formRow} style={{ alignContent: "end" }}>
                <label className={css.checkboxRow}>
                  <input
                    type="checkbox"
                    className={css.checkbox}
                    checked={background}
                    disabled={saving}
                    onChange={event => setBackground(event.target.checked)}
                  />
                  <span>{t("subagent.editor.background")}</span>
                </label>
              </div>
            </div>

            <label className={css.formRow}>
              <span className={css.formLabel}>{t("subagent.editor.systemPrompt")}</span>
              <textarea
                className={css.textareaInput}
                value={systemPrompt}
                placeholder={t("subagent.editor.systemPromptPlaceholder")}
                disabled={saving}
                onChange={event => setSystemPrompt(event.target.value)}
              />
            </label>

            {(localError || error) && (
              <p className={css.modalError} role="alert">{localError || error}</p>
            )}
          </div>

          <footer className={css.modalFooter}>
            <button type="button" className={css.secondaryBtn} disabled={saving} onClick={onClose}>
              {t("subagent.editor.cancel")}
            </button>
            <button type="submit" className={css.primaryBtn} disabled={saving}>
              {t(saving ? "subagent.editor.saving" : "subagent.editor.save")}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  );
}
