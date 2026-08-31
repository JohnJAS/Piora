"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import type { SystemPromptCatalog, SystemPromptTemplate } from "@/lib/system-prompt-types";
import { AliIcon } from "./AliIcon";
import { requestConfirmation } from "./ConfirmDialog";
import styles from "./SystemPromptEditor.module.css";

interface SystemPromptResponse extends SystemPromptCatalog {
  error?: string;
}

interface Props {
  effectivePrompt: string | null;
  compact?: boolean;
  onSaved?: () => void;
}

const EMPTY_CATALOG: SystemPromptCatalog = {
  templates: [],
  defaultTemplateId: null,
  maxPromptLength: 100_000,
  maxNameLength: 80,
};

async function requestCatalog(method: string, body?: Record<string, unknown>): Promise<SystemPromptCatalog> {
  const response = await fetch("/api/system-prompt", {
    method,
    ...(body ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    } : {}),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as SystemPromptResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export function SystemPromptEditor({ effectivePrompt, compact = false, onSaved }: Props) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<SystemPromptCatalog>(EMPTY_CATALOG);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTemplate = catalog.templates.find((template) => template.id === selectedId) ?? null;

  const chooseTemplate = useCallback((template: SystemPromptTemplate) => {
    setSelectedId(template.id);
    setCreating(false);
    setName(template.name);
    setPrompt(template.prompt);
    setStatus(null);
    setError(null);
  }, []);

  const applyCatalog = useCallback((next: SystemPromptCatalog, preferredId?: string | null) => {
    setCatalog(next);
    const nextSelected = next.templates.find((template) => template.id === preferredId)
      ?? next.templates.find((template) => template.id === next.defaultTemplateId)
      ?? next.templates[0]
      ?? null;
    if (nextSelected) chooseTemplate(nextSelected);
    else {
      setSelectedId(null);
      setCreating(true);
      setName("");
      setPrompt("");
    }
  }, [chooseTemplate]);

  useEffect(() => {
    let cancelled = false;
    void requestCatalog("GET")
      .then((next) => { if (!cancelled) applyCatalog(next); })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [applyCatalog]);

  const publish = useCallback((next: SystemPromptCatalog, preferredId?: string | null) => {
    applyCatalog(next, preferredId);
    window.dispatchEvent(new CustomEvent("piora:system-prompt-changed"));
    onSaved?.();
  }, [applyCatalog, onSaved]);

  const save = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const next = creating
        ? await requestCatalog("POST", { name, prompt })
        : await requestCatalog("PATCH", { id: selectedId, name, prompt });
      const preferred = creating
        ? next.templates.find((template) => template.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())?.id
        : selectedId;
      publish(next, preferred ?? null);
      setStatus(t(creating ? "system.templateCreated" : "system.templateSaved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }, [creating, name, prompt, publish, selectedId, t]);

  const setDefault = useCallback(async (id: string | null) => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const next = await requestCatalog("PATCH", { defaultTemplateId: id });
      publish(next, selectedId);
      setStatus(t("system.defaultUpdated"));
    } catch (defaultError) {
      setError(defaultError instanceof Error ? defaultError.message : String(defaultError));
    } finally {
      setSaving(false);
    }
  }, [publish, selectedId, t]);

  const remove = useCallback(async () => {
    if (!selectedTemplate || !await requestConfirmation({
      title: t("system.deleteTemplate"),
      message: t("system.deleteTemplateConfirm", { name: selectedTemplate.name }),
      confirmLabel: t("system.deleteTemplate"),
      tone: "danger",
    })) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const next = await requestCatalog("DELETE", { id: selectedTemplate.id });
      publish(next);
      setStatus(t("system.templateDeleted"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setSaving(false);
    }
  }, [publish, selectedTemplate, t]);

  const dirty = creating
    ? Boolean(name.trim() || prompt)
    : Boolean(selectedTemplate && (name !== selectedTemplate.name || prompt !== selectedTemplate.prompt));

  return (
    <div className={`${styles.editor}${compact ? ` ${styles.compact}` : ""}`}>
      <div className={styles.library}>
        <div className={styles.libraryHeader}>
          <span>{t("system.templateLibrary")}</span>
          <button
            type="button"
            disabled={loading || saving}
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
              setName("");
              setPrompt("");
              setStatus(null);
              setError(null);
            }}
          >
            <AliIcon name="plus" size={12} />
            {t("system.newTemplate")}
          </button>
        </div>
        <div className={styles.templateList} aria-label={t("system.templateLibrary")}>
          <button
            type="button"
            className={styles.piDefaultRow}
            data-default={catalog.defaultTemplateId === null ? "true" : undefined}
            disabled={saving}
            onClick={() => void setDefault(null)}
          >
            <AliIcon name="setting" size={14} />
            <span><strong>{t("system.piDefault")}</strong><small>{t("system.piDefaultDescription")}</small></span>
            {catalog.defaultTemplateId === null ? <em>{t("system.defaultBadgeShort")}</em> : null}
          </button>
          {catalog.templates.map((template) => (
            <button
              key={template.id}
              type="button"
              aria-pressed={!creating && template.id === selectedId}
              disabled={saving}
              onClick={() => chooseTemplate(template)}
            >
              <AliIcon name="file" size={14} />
              <span><strong>{template.name}</strong><small>{template.prompt || t("system.emptyTemplate")}</small></span>
              {template.id === catalog.defaultTemplateId ? <em>{t("system.defaultBadgeShort")}</em> : null}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.form}>
        <div className={styles.formHeading}>
          <span>{t(creating ? "system.newTemplate" : "system.editTemplate")}</span>
          {!creating && selectedTemplate ? (
            <div>
              {catalog.defaultTemplateId !== selectedTemplate.id ? (
                <button type="button" disabled={saving} onClick={() => void setDefault(selectedTemplate.id)}>
                  {t("system.makeDefault")}
                </button>
              ) : null}
              <button type="button" disabled={saving} data-danger="true" onClick={() => void remove()}>
                {t("system.deleteTemplate")}
              </button>
            </div>
          ) : null}
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("system.templateName")}</span>
          <input
            value={name}
            maxLength={catalog.maxNameLength}
            disabled={loading || saving}
            placeholder={t("system.templateNamePlaceholder")}
            onChange={(event) => { setName(event.target.value); setStatus(null); setError(null); }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>{t("system.customLabel")}</span>
          <span className={styles.fieldDescription}>{t("system.templateDescription")}</span>
          <textarea
            className={styles.textarea}
            value={prompt}
            rows={compact ? 8 : 12}
            maxLength={catalog.maxPromptLength}
            disabled={loading || saving}
            placeholder={t("system.customPlaceholder")}
            onChange={(event) => { setPrompt(event.target.value); setStatus(null); setError(null); }}
          />
        </label>

        <div className={styles.footer}>
          <div className={styles.feedback}>
            <span role={error ? "alert" : "status"} data-error={Boolean(error)}>{error ?? status ?? t("system.snapshotHint")}</span>
            <span className={styles.count}>{Array.from(prompt).length.toLocaleString()} / {catalog.maxPromptLength.toLocaleString()}</span>
          </div>
          <div className={styles.actions}>
            <button className={styles.primaryButton} type="button" disabled={loading || saving || !dirty || !name.trim()} onClick={() => void save()}>
              {saving ? t("system.saving") : t("system.saveTemplate")}
            </button>
          </div>
        </div>
      </div>

      {!compact ? (
        <details className={styles.effectivePrompt}>
          <summary>
            <span><strong>{t("system.effectiveLabel")}</strong><small>{t("system.effectiveDescription")}</small></span>
          </summary>
          <pre>{effectivePrompt === null ? t("system.load") : effectivePrompt || t("system.empty")}</pre>
        </details>
      ) : null}
    </div>
  );
}
