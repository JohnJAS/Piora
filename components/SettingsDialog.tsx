"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenModels: () => void;
  onOpenSkills: () => void;
  onOpenPlugins: () => void;
  onOpenAppearance: () => void;
  onOpenLanguage: () => void;
  onOpenCompanion: () => void;
}

interface SettingsEntry {
  key: string;
  labelKey: string;
  descriptionKey: string;
  icon: React.ReactNode;
  onClick: () => void;
}

export function SettingsDialog({
  open,
  onClose,
  onOpenModels,
  onOpenSkills,
  onOpenPlugins,
  onOpenAppearance,
  onOpenLanguage,
  onOpenCompanion,
}: Props) {
  const { t } = useI18n();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !portalTarget) return null;

  const entries: SettingsEntry[] = [
    {
      key: "models",
      labelKey: "common.models",
      descriptionKey: "settings.modelsDescription",
      onClick: onOpenModels,
      icon: <AliIcon name="api" size={15} />,
    },
    {
      key: "skills",
      labelKey: "common.skills",
      descriptionKey: "settings.skillsDescription",
      onClick: onOpenSkills,
      icon: <AliIcon name="solution" size={15} />,
    },
    {
      key: "plugins",
      labelKey: "common.plugins",
      descriptionKey: "settings.pluginsDescription",
      onClick: onOpenPlugins,
      icon: <AliIcon name="appstore-add" size={15} />,
    },
    {
      key: "appearance",
      labelKey: "appearance.title",
      descriptionKey: "settings.appearanceDescription",
      onClick: onOpenAppearance,
      icon: <AliIcon name="skin" size={15} />,
    },
    {
      key: "language",
      labelKey: "common.language",
      descriptionKey: "settings.languageDescription",
      onClick: onOpenLanguage,
      icon: <AliIcon name="translate" size={15} />,
    },
    {
      key: "companion",
      labelKey: "companion.settingsTitle",
      descriptionKey: "companion.settingsDescription",
      onClick: onOpenCompanion,
      icon: <AliIcon name="robot" size={15} />,
    },
  ];

  return createPortal(
    <div
      className="app-shell-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("sidebar.settings")}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 1200,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.35)",
      }}
    >
      <div
        className="app-shell-dialog"
        style={{
          width: 440, maxWidth: "calc(100vw - 24px)",
          maxHeight: "calc(100dvh - 32px)", overflow: "hidden",
          display: "flex", flexDirection: "column",
          background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        <div className="app-shell-dialog-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px 10px" }}>
          <div>
            <div style={{ color: "var(--text)", fontWeight: 700, fontSize: "var(--font-lg)" }}>{t("sidebar.settings")}</div>
            <div style={{ marginTop: 2, color: "var(--text-muted)", fontSize: "var(--font-xs)" }}>{t("settings.description")}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            style={{ padding: "2px 6px", border: 0, background: "none", color: "var(--text-muted)", fontSize: "var(--font-4xl)", lineHeight: 1, cursor: "pointer" }}
          >
            <AliIcon name="close" size={14} />
          </button>
        </div>

        <div className="app-shell-dialog-body" style={{ overflowY: "auto", padding: "6px 12px 14px" }}>
          {entries.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={entry.onClick}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px", border: "none", borderRadius: 9,
                background: "none", color: "var(--text)", cursor: "pointer", textAlign: "left",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
            >
              <span style={{
                flexShrink: 0, width: 34, height: 34, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--bg-panel)", border: "1px solid var(--border)", color: "var(--text-muted)",
              }}>
                {entry.icon}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: "var(--font-md)", fontWeight: 600 }}>{t(entry.labelKey)}</span>
                <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: "var(--font-xs)", lineHeight: 1.45 }}>
                  {t(entry.descriptionKey)}
                </span>
              </span>
              <AliIcon name="arrowright" size={12} style={{ color: "var(--text-dim)" }} />
            </button>
          ))}
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
