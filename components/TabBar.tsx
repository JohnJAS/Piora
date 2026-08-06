"use client";

import { useState } from "react";
import { getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";
import { AliIcon } from "./AliIcon";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  initialDisplayMode?: "source" | "preview" | "diff" | "edit";
  isDirty?: boolean;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const { t } = useI18n();
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);

  const moveFocus = (currentId: string, direction: -1 | 1) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === currentId);
    if (currentIndex < 0 || tabs.length === 0) return;
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    onSelectTab(tabs[nextIndex].id);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-file-tab-id="${CSS.escape(tabs[nextIndex].id)}"]`)?.focus();
    });
  };

  return (
    <div
      className="file-tab-list"
      role="tablist"
      aria-label={t("files.openFiles")}
      style={{
        display: "flex",
        alignItems: "flex-end",
        background: "var(--bg-panel)",
        overflowX: "auto",
        flexShrink: 0,
        minHeight: "max(40px, calc(var(--font-sm) + 28px))",
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            className={`file-tab${isActive ? " is-active" : ""}`}
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            data-file-tab-id={tab.id}
            onClick={() => onSelectTab(tab.id)}
            onMouseEnter={() => setHoveredTab(tab.id)}
            onMouseLeave={() => setHoveredTab(null)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveFocus(tab.id, -1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                moveFocus(tab.id, 1);
              } else if (event.key === "Home" && tabs[0]) {
                event.preventDefault();
                onSelectTab(tabs[0].id);
              } else if (event.key === "End" && tabs[tabs.length - 1]) {
                event.preventDefault();
                onSelectTab(tabs[tabs.length - 1].id);
              } else if (event.key === "Delete") {
                event.preventDefault();
                onCloseTab(tab.id);
              }
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minHeight: "max(32px, calc(var(--font-sm) + 20px))",
              margin: "4px 2px",
              paddingLeft: 12,
              paddingRight: 6,
              border: "1px solid transparent",
              borderRadius: "var(--radius-control)",
              background: isActive ? "var(--bg)" : "transparent",
              cursor: "pointer",
              fontSize: "var(--font-sm)",
              color: isActive ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 180,
              minWidth: 80,
              flexShrink: 0,
              userSelect: "none",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
              {getFileIcon(tab.label, 13)}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                fontWeight: isActive ? 500 : 400,
              }}
              title={tab.filePath}
            >
              {tab.label}
            </span>
            {tab.isDirty && (
              <span
                title="Unsaved changes"
                aria-label="Unsaved changes"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "color-mix(in srgb, #d99a28 82%, var(--text))",
                  boxShadow: "0 0 0 2px color-mix(in srgb, #d99a28 14%, transparent)",
                  flex: "0 0 7px",
                }}
              />
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              onMouseEnter={() => setHoveredClose(tab.id)}
              onMouseLeave={() => setHoveredClose(null)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24,
                background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                border: "none",
                borderRadius: "var(--radius-small)",
                color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
                transition: "background 0.1s, color 0.1s",
                opacity: isActive || hoveredTab === tab.id || hoveredClose === tab.id ? 1 : 0,
                pointerEvents: isActive || hoveredTab === tab.id ? "auto" : "none",
              }}
               title={t("i18n.close")}
               aria-label={`${t("i18n.close")} ${tab.label}`}
            >
              <AliIcon name="close" size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
