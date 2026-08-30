"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";

type StoragePaths = { screenshotDirectory: string; recordingDirectory: string };
type ConfigPayload = {
  config?: { storage?: Partial<StoragePaths> };
  storage?: StoragePaths;
  error?: string | { message?: string };
};

function errorText(payload: ConfigPayload, status: number): string {
  return typeof payload.error === "string" ? payload.error : payload.error?.message || `HTTP ${status}`;
}

export function HarmonyStorageSettings() {
  const { t } = useI18n();
  const [desktopAvailable, setDesktopAvailable] = useState<boolean | null>(null);
  const [paths, setPaths] = useState<StoragePaths>({ screenshotDirectory: "", recordingDirectory: "" });
  const [defaults, setDefaults] = useState<StoragePaths | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/harmony/config", { cache: "no-store" });
      const payload = await response.json() as ConfigPayload;
      if (!response.ok || !payload.storage) throw new Error(errorText(payload, response.status));
      setDefaults(payload.storage);
      setPaths({
        screenshotDirectory: payload.config?.storage?.screenshotDirectory || payload.storage.screenshotDirectory,
        recordingDirectory: payload.config?.storage?.recordingDirectory || payload.storage.recordingDirectory,
      });
      setError("");
      setStatus("idle");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const available = Boolean(window.piDesktop);
    setDesktopAvailable(available);
    if (available) void load();
    else setStatus("idle");
  }, [load]);

  const choose = async (field: keyof StoragePaths) => {
    const selected = await window.piDesktop?.selectDirectory?.();
    if (selected) setPaths((current) => ({ ...current, [field]: selected }));
  };

  const save = async (reset = false) => {
    setStatus("saving");
    try {
      const response = await fetch("/api/harmony/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage: reset ? null : {
            screenshotDirectory: paths.screenshotDirectory.trim(),
            recordingDirectory: paths.recordingDirectory.trim(),
          },
        }),
      });
      const payload = await response.json() as ConfigPayload;
      if (!response.ok || !payload.storage) throw new Error(errorText(payload, response.status));
      setDefaults(payload.storage);
      setPaths(payload.storage);
      setError("");
      setStatus("saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus("error");
    }
  };

  const field = (key: keyof StoragePaths, label: string, description: string) => (
    <label style={{ display: "grid", gap: 7 }}>
      <span style={{ display: "grid", gap: 2 }}>
        <strong style={{ color: "var(--text)", fontSize: "var(--text-sm)" }}>{label}</strong>
        <small style={{ color: "var(--text-dim)", lineHeight: 1.45 }}>{description}</small>
      </span>
      <span style={{ display: "flex", gap: 8 }}>
        <input
          aria-label={label}
          value={paths[key]}
          onChange={(event) => { setPaths((current) => ({ ...current, [key]: event.target.value })); setStatus("idle"); }}
          style={{ flex: 1, minWidth: 0 }}
        />
        {window.piDesktop?.selectDirectory ? (
          <button type="button" onClick={() => void choose(key)} title={t("harmonyStorage.choose")} aria-label={t("harmonyStorage.choose")}>
            <AliIcon name="folder-open" size={14} />
          </button>
        ) : null}
      </span>
    </label>
  );

  return (
    <div className="settings-embedded-surface" style={{ height: "100%", overflowY: "auto", padding: "26px 30px 34px" }}>
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ margin: 0, color: "var(--text)", fontSize: "calc(var(--text-lg) * 1.22)", fontWeight: 680 }}>{t("harmonyStorage.title")}</h2>
        <p style={{ margin: "7px 0 0", color: "var(--text-muted)", fontSize: "var(--text-sm)", lineHeight: 1.55 }}>{t("harmonyStorage.description")}</p>
      </div>
      {desktopAvailable === false ? (
        <section className="settings-conversation-section" style={{ maxWidth: 760 }}>
          <p style={{ margin: 0, color: "var(--text-muted)", lineHeight: 1.55 }}>{t("harmonyStorage.desktopOnly")}</p>
        </section>
      ) : null}
      {desktopAvailable !== false ? (
      <section className="settings-conversation-section" style={{ display: "grid", gap: 20, maxWidth: 760 }}>
        {field("screenshotDirectory", t("harmonyStorage.screenshotDirectory"), t("harmonyStorage.screenshotDescription"))}
        {field("recordingDirectory", t("harmonyStorage.recordingDirectory"), t("harmonyStorage.recordingDescription"))}
        {defaults ? <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "var(--text-xs)", lineHeight: 1.5 }}>{t("harmonyStorage.absolutePathHint")}</p> : null}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" disabled={status === "saving" || !paths.screenshotDirectory.trim() || !paths.recordingDirectory.trim()} onClick={() => void save(false)}>
            {status === "saving" ? t("harmonyStorage.saving") : t("harmonyStorage.save")}
          </button>
          <button type="button" disabled={status === "saving"} onClick={() => void save(true)}>{t("harmonyStorage.restoreDefaults")}</button>
          {status === "saved" ? <span role="status" style={{ color: "var(--status-success)", fontSize: "var(--text-xs)" }}>{t("harmonyStorage.saved")}</span> : null}
        </div>
        {status === "loading" ? <p>{t("harmonyStorage.loading")}</p> : null}
        {error ? <p role="alert" style={{ color: "var(--status-failed)", overflowWrap: "anywhere" }}>{error}</p> : null}
      </section>
      ) : null}
    </div>
  );
}
