"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";
import styles from "./CompanionStorageSettings.module.css";

interface StorageInfo {
  directory: string;
  defaultDirectory: string;
  dataFile: string;
  configFile: string;
  customized: boolean;
}

interface StoragePayload {
  storage?: StorageInfo;
  error?: string;
}

export function CompanionStorageSettings({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [directory, setDirectory] = useState("");
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/companion/storage", { cache: "no-store" });
      const payload = await response.json() as StoragePayload;
      if (!response.ok || !payload.storage) throw new Error(payload.error || `HTTP ${response.status}`);
      setStorage(payload.storage);
      setDirectory(payload.storage.directory);
      setError("");
      setStatus("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const chooseDirectory = async () => {
    const selected = await window.piDesktop?.selectDirectory?.();
    if (selected) {
      setDirectory(selected);
      setStatus("idle");
    }
  };

  const save = async (nextDirectory: string) => {
    setStatus("saving");
    setError("");
    try {
      const response = await fetch("/api/companion/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: nextDirectory.trim() }),
      });
      const payload = await response.json() as StoragePayload;
      if (!response.ok || !payload.storage) throw new Error(payload.error || `HTTP ${response.status}`);
      setStorage(payload.storage);
      setDirectory(payload.storage.directory);
      setEditing(false);
      setStatus("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    }
  };

  return (
    <section className={`${styles.section}${compact ? ` ${styles.compact}` : ""}`} aria-labelledby="companion-storage-title">
      <div className={styles.heading}>
        <div>
          <h3 id="companion-storage-title">{t("companion.storage.title")}</h3>
          <p>{t("companion.storage.description")}</p>
        </div>
      </div>

      <div className={styles.editRow}>
        <span className={styles.editIcon} aria-hidden="true"><AliIcon name="folder-open" size={15} /></span>
        <span><b>{t("companion.storage.edit")}</b><small>{t("companion.storage.editDescription")}</small></span>
        <button type="button" role="switch" aria-checked={editing} aria-label={t("companion.storage.edit")} onClick={() => {
          setEditing((current) => !current);
          setDirectory(storage?.directory ?? "");
          setError("");
          setStatus("idle");
        }}><span /></button>
      </div>

      {editing ? <div className={styles.editor}>
        <label>
          <span>{t("companion.storage.directory")}</span>
          <span className={styles.inputRow}>
            <input value={directory} onChange={(event) => { setDirectory(event.currentTarget.value); setStatus("idle"); }} />
            {typeof window !== "undefined" && window.piDesktop?.selectDirectory ? <button type="button" onClick={() => void chooseDirectory()} title={t("companion.storage.choose")} aria-label={t("companion.storage.choose")}><AliIcon name="folder-open" size={14} /></button> : null}
          </span>
        </label>
        <p>{t("companion.storage.migrationHint")}</p>
        <div className={styles.actions}>
          <button className={styles.primary} type="button" disabled={status === "saving" || !directory.trim() || directory.trim() === storage?.directory} onClick={() => void save(directory)}>{status === "saving" ? t("companion.storage.saving") : t("companion.storage.apply")}</button>
          {storage?.customized ? <button type="button" disabled={status === "saving"} onClick={() => void save(storage.defaultDirectory)}>{t("companion.storage.restoreDefault")}</button> : null}
        </div>
      </div> : null}

      <dl className={styles.paths} aria-live="polite">
        <div><dt>{t("companion.storage.dataFile")}</dt><dd>{storage?.dataFile || t("companion.storage.loading")}</dd></div>
        <div><dt>{t("companion.storage.configFile")}</dt><dd>{storage?.configFile || t("companion.storage.loading")}</dd></div>
      </dl>
      {status === "saved" ? <p className={styles.success} role="status">{t("companion.storage.saved")}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}
