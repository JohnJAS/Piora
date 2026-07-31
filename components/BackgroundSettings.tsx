"use client";

import { useId, useRef } from "react";
import { useBackground } from "@/hooks/useBackground";
import { useI18n } from "@/hooks/useI18n";
import { getBackgroundPreset, SUPPORTED_BACKGROUND_MIME_TYPES } from "@/lib/backgrounds";
import type { BackgroundStorageErrorCode } from "@/lib/background-storage";
import styles from "./BackgroundSettings.module.css";

const ERROR_KEYS: Record<BackgroundStorageErrorCode, string> = {
  "corrupt-image": "background.error.corruptImage",
  "dimensions-too-large": "background.error.dimensionsTooLarge",
  "empty-file": "background.error.emptyFile",
  "file-too-large": "background.error.fileTooLarge",
  "missing-custom": "background.error.missingCustom",
  "storage-unavailable": "background.error.storageUnavailable",
  "unsupported-type": "background.error.unsupportedType",
};

export interface BackgroundSettingsProps {
  compact?: boolean;
  className?: string;
}

/**
 * Host-owned appearance controls. Mount this inside an existing settings or
 * theme surface; BackgroundBootstrap handles startup application separately.
 */
export function BackgroundSettings({ compact = false, className }: BackgroundSettingsProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const {
    preference,
    hydrated,
    busy,
    hasStoredCustom,
    customName,
    error,
    presets,
    setNone,
    setBuiltin,
    selectStoredCustom,
    uploadCustom,
    setOverlay,
    setBlur,
    reset,
  } = useBackground();

  const selection = preference.source === "builtin" && preference.presetId
    ? `builtin:${preference.presetId}`
    : preference.source;
  const selectedPreset = getBackgroundPreset(preference.presetId);
  const previewBackground = selectedPreset
    ? selectedPreset.artworkStatus === "available"
      ? `url("${selectedPreset.asset}"), ${selectedPreset.fallback}`
      : selectedPreset.fallback
    : preference.source === "custom"
      ? "linear-gradient(135deg, color-mix(in srgb, var(--accent) 25%, var(--bg)), var(--bg-panel))"
      : "linear-gradient(135deg, var(--bg), var(--bg-panel))";

  return (
    <section
      className={`${styles.section}${compact ? ` ${styles.compact}` : ""}${className ? ` ${className}` : ""}`}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        // AppShell's theme menu uses arrow keys for its radio items. Keep form
        // control arrows local when this component is embedded in that menu.
        if (["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.stopPropagation();
        }
      }}
    >
      <div className={styles.header}>
        <div>
          <h3 id={titleId} className={styles.title}>{t("background.title")}</h3>
          <p className={styles.hint}>{t("background.localOnlyHint")}</p>
        </div>
      </div>

      <div className={styles.preview} aria-hidden="true" style={{ backgroundImage: previewBackground }} />

      <label className={styles.field}>
        <span className={styles.fieldHeader}>{t("background.source")}</span>
        <select
          className={styles.select}
          value={selection}
          disabled={!hydrated || busy}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "none") setNone();
            else if (value === "custom") void selectStoredCustom();
            else if (value.startsWith("builtin:")) setBuiltin(value.slice("builtin:".length));
          }}
        >
          <option value="none">{t("background.none")}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={`builtin:${preset.id}`}>
              {t(preset.nameKey)}{preset.artworkStatus === "planned" ? ` · ${t("background.previewFallback")}` : ""}
            </option>
          ))}
          {hasStoredCustom ? (
            <option value="custom">{t("background.savedCustom", { name: customName || t("background.localImage") })}</option>
          ) : null}
        </select>
      </label>

      <div className={styles.actions}>
        <label className={styles.uploadButton} data-disabled={busy ? "true" : "false"}>
          {busy ? t("background.processing") : t("background.chooseLocal")}
          <input
            ref={inputRef}
            className={styles.fileInput}
            type="file"
            accept={SUPPORTED_BACKGROUND_MIME_TYPES.join(",")}
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void uploadCustom(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <button className={styles.button} type="button" disabled={busy} onClick={() => void reset()}>
          {t("background.reset")}
        </button>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldHeader}>
          <span>{t("background.overlay")}</span>
          <span>{preference.overlay}%</span>
        </span>
        <input
          className={styles.range}
          type="range"
          min={0}
          max={90}
          step={1}
          value={preference.overlay}
          disabled={preference.source === "none" || busy}
          onChange={(event) => setOverlay(Number(event.currentTarget.value))}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.fieldHeader}>
          <span>{t("background.blur")}</span>
          <span>{preference.blur}px</span>
        </span>
        <input
          className={styles.range}
          type="range"
          min={0}
          max={24}
          step={1}
          value={preference.blur}
          disabled={preference.source === "none" || busy}
          onChange={(event) => setBlur(Number(event.currentTarget.value))}
        />
      </label>

      {selectedPreset?.artworkStatus === "planned" ? (
        <p className={styles.status} role="status">{t("background.artworkPending")}</p>
      ) : null}
      {error ? <p className={styles.error} role="alert">{t(ERROR_KEYS[error])}</p> : null}
    </section>
  );
}
