"use client";

import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import type {
  SessionSystemPromptBinding,
  SystemPromptCatalog,
  SystemPromptSelection,
} from "@/lib/system-prompt-types";
import { AliIcon } from "./AliIcon";
import styles from "./SystemPromptSelector.module.css";

interface Props {
  selection: SystemPromptSelection;
  binding?: SessionSystemPromptBinding | null;
  disabled?: boolean;
  onChange: (selection: SystemPromptSelection) => void | Promise<void>;
}

function selectionValue(selection: SystemPromptSelection): string {
  return selection.mode === "template" ? selection.templateId : "__default__";
}

export function SystemPromptSelector({ selection, binding, disabled = false, onChange }: Props) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<SystemPromptCatalog | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/system-prompt", { cache: "no-store" });
      const data = await response.json() as SystemPromptCatalog & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setCatalog(data);
    } catch {
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const reload = () => { void load(); };
    window.addEventListener("piora:system-prompt-changed", reload);
    return () => window.removeEventListener("piora:system-prompt-changed", reload);
  }, [load]);

  const defaultTemplate = catalog?.templates.find((template) => template.id === catalog.defaultTemplateId);
  const selectedTemplateExists = selection.mode === "template"
    && Boolean(catalog?.templates.some((template) => template.id === selection.templateId));
  const label = selection.mode === "template"
    ? catalog?.templates.find((template) => template.id === selection.templateId)?.name
      ?? binding?.templateName
      ?? t("system.snapshot")
    : defaultTemplate?.name ?? t("system.piDefault");

  return (
    <label className={styles.control} title={t("system.selectorDescription")}>
      <AliIcon name="file" size={13} />
      <span className={styles.visualLabel}>{label}</span>
      <select
        value={selectionValue(selection)}
        disabled={disabled || loading}
        aria-label={t("system.selectTemplate")}
        onChange={(event) => {
          const value = event.target.value;
          void onChange(value === "__default__"
            ? { mode: "default" }
            : { mode: "template", templateId: value });
        }}
      >
        <option value="__default__">
          {t("system.defaultOption", { name: defaultTemplate?.name ?? t("system.piDefault") })}
        </option>
        {catalog?.templates.map((template) => (
          <option key={template.id} value={template.id}>{template.name}</option>
        ))}
        {selection.mode === "template" && !selectedTemplateExists ? (
          <option value={selection.templateId}>{binding?.templateName ?? t("system.snapshot")}</option>
        ) : null}
      </select>
      <AliIcon name="arrowdown" size={9} />
    </label>
  );
}
