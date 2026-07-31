"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenModels: () => void;
  onOpenSkills: () => void;
  onOpenPlugins: () => void;
  onOpenAppearance: () => void;
  onOpenLanguage: () => void;
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
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
          <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
          <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
        </svg>
      ),
    },
    {
      key: "skills",
      labelKey: "common.skills",
      descriptionKey: "settings.skillsDescription",
      onClick: onOpenSkills,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      ),
    },
    {
      key: "plugins",
      labelKey: "common.plugins",
      descriptionKey: "settings.pluginsDescription",
      onClick: onOpenPlugins,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 7V2" />
          <path d="M15 7V2" />
          <path d="M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0Z" />
          <path d="M12 19v3" />
        </svg>
      ),
    },
    {
      key: "appearance",
      labelKey: "appearance.title",
      descriptionKey: "settings.appearanceDescription",
      onClick: onOpenAppearance,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3a9 9 0 1 0 0 18h1.4a1.6 1.6 0 0 0 1.1-2.7 1.6 1.6 0 0 1 1.1-2.7H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z" />
          <circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="6.8" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="7.8" r="1" fill="currentColor" stroke="none" />
        </svg>
      ),
    },
    {
      key: "language",
      labelKey: "common.language",
      descriptionKey: "settings.languageDescription",
      onClick: onOpenLanguage,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <path d="M12 3a14.5 14.5 0 0 1 0 18 14.5 14.5 0 0 1 0-18z" />
        </svg>
      ),
    },
  ];

  return createPortal(
    <div
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
        style={{
          width: 440, maxWidth: "calc(100vw - 24px)",
          maxHeight: "calc(100dvh - 32px)", overflow: "hidden",
          display: "flex", flexDirection: "column",
          background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px 10px" }}>
          <div>
            <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 15 }}>{t("sidebar.settings")}</div>
            <div style={{ marginTop: 2, color: "var(--text-muted)", fontSize: 11 }}>{t("settings.description")}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            style={{ padding: "2px 6px", border: 0, background: "none", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "6px 12px 14px" }}>
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
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{t(entry.labelKey)}</span>
                <span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>
                  {t(entry.descriptionKey)}
                </span>
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "var(--text-dim)" }}>
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
