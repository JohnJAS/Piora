"use client";

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { SideChatStorage, SideChatSummary } from "@/lib/side-chat/types";
import type { TaskRuntimeSnapshot } from "@/lib/task-status";
import { AliIcon } from "../AliIcon";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import {
  toSideChatLoadingTabId,
  toSideChatTabId,
  type SideChatTabId,
} from "./side-chat-events";
import { SideChatTabView } from "./SideChatTabView";
import type {
  PendingSideChatCreate,
  SideChatLaunchPayload,
  SideChatLiveActivity,
} from "./useSideChatController";
import sideStyles from "./SideChat.module.css";

export interface RightPanelSideChatProps {
  enabled: boolean;
  canCreate: boolean;
  items: SideChatSummary[];
  openIds: string[];
  pendingCreates: PendingSideChatCreate[];
  unreadIds: ReadonlySet<string>;
  parentSnapshot?: TaskRuntimeSnapshot | null;
  parentRunning?: boolean;
  errorBanner?: string | null;
  onDismissError?: () => void;
  onOpenNew: (storage?: SideChatStorage) => void;
  onSelect: (sideId: string) => void;
  onRequestCloseTab: (sideId: string) => void;
  onRename: (sideId: string, name: string) => Promise<void>;
  onToggleArchive: (sideId: string, archived: boolean) => Promise<void>;
  onDelete: (sideId: string) => Promise<void>;
  onPromote: (sideId: string) => Promise<void>;
  onRestartExpired: (sideId: string) => void;
  onJumpToParent: () => void;
  onOpenFile?: (filePath: string) => void;
  onAgentEnd: (sideId: string) => void;
  onActivityChange?: (sideId: string, activity: SideChatLiveActivity) => void;
  pendingLaunchBySideId: ReadonlyMap<string, SideChatLaunchPayload>;
  onConsumeLaunch: (sideId: string) => void;
}

export function SideChatMenuEntries({
  sideChat,
  variant,
  onAfterSelect,
}: {
  sideChat?: RightPanelSideChatProps;
  variant: "menu" | "launcher";
  onAfterSelect?: () => void;
}) {
  const { t } = useI18n();
  if (!sideChat?.enabled || !sideChat.canCreate) return null;

  return (
    <>
      <button
        type="button"
        role={variant === "menu" ? "menuitem" : undefined}
        onClick={() => {
          onAfterSelect?.();
          sideChat.onOpenNew("attached");
        }}
      >
        <AliIcon name="chat-bubble-plus" size={15} />
        <span>{t("sideChat.newAttached")}</span>
      </button>
      <button
        type="button"
        role={variant === "menu" ? "menuitem" : undefined}
        onClick={() => {
          onAfterSelect?.();
          sideChat.onOpenNew("temporary");
        }}
      >
        <AliIcon name="timer" size={15} />
        <span>{t("sideChat.newTemporary")}</span>
      </button>
    </>
  );
}

export function SideChatTabStripItems({
  sideChat,
  activeTab,
  tabClassName,
  closeClassName,
  activeTabRef,
  onActivateTab,
  onTabKeyDown,
}: {
  sideChat?: RightPanelSideChatProps;
  activeTab: string;
  tabClassName: string;
  closeClassName: string;
  activeTabRef: MutableRefObject<HTMLButtonElement | null>;
  onActivateTab: (tab: SideChatTabId) => void;
  onTabKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>, tab: SideChatTabId) => void;
}) {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{ sideId: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  if (!sideChat?.enabled) return null;

  const menuTarget = contextMenu ? sideChat.items.find((item) => item.id === contextMenu.sideId) : undefined;

  const commitRename = async (sideId: string) => {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (trimmed) await sideChat.onRename(sideId, trimmed);
  };

  return (
    <>
      {sideChat.openIds.map((sideId) => {
        const item = sideChat.items.find((candidate) => candidate.id === sideId);
        if (!item) return null;
        const tabId = toSideChatTabId(sideId);
        const selected = activeTab === tabId;
        const label = item.isDefaultTitle ? t("sideChat.untitled") : item.title;
        return (
          <div
            key={tabId}
            className={tabClassName}
            data-active={selected ? "true" : "false"}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({
                sideId,
                x: Math.min(event.clientX, window.innerWidth - 180),
                y: Math.min(event.clientY, window.innerHeight - 210),
              });
            }}
          >
            {renamingId === sideId ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px" }}>
                <input
                  className={sideStyles.renameInput}
                  aria-label={t("sideChat.renamePlaceholder")}
                  value={renameValue}
                  autoFocus
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => { void commitRename(sideId); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void commitRename(sideId);
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setRenamingId(null);
                    }
                  }}
                />
              </div>
            ) : (
              <button
                ref={selected ? activeTabRef : undefined}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`workspace-${tabId}`}
                id={`workspace-${tabId}-tab`}
                tabIndex={selected ? 0 : -1}
                onClick={() => sideChat.onSelect(sideId)}
                onKeyDown={(event) => onTabKeyDown?.(event, tabId)}
              >
                <AliIcon name={item.storage === "temporary" ? "timer" : "chat-bubble"} size={13} />
                <span>{label}</span>
                {item.running ? (
                  <span className={sideStyles.statusDot} data-status="running" title={t("sideChat.runningIndicator")} />
                ) : sideChat.unreadIds.has(sideId) ? (
                  <span className={sideStyles.tabUnreadDot} title={t("sideChat.unreadIndicator")} />
                ) : null}
              </button>
            )}
            <button
              className={closeClassName}
              type="button"
              aria-label={t("sideChat.action.closeTab")}
              onClick={() => sideChat.onRequestCloseTab(sideId)}
            >
              <AliIcon name="close" size={12} />
            </button>
          </div>
        );
      })}

      {sideChat.pendingCreates.map((entry) => {
        const tabId = toSideChatLoadingTabId(entry.clientId);
        const selected = activeTab === tabId;
        return (
          <div key={tabId} className={tabClassName} data-active={selected ? "true" : "false"}>
            <button
              ref={selected ? activeTabRef : undefined}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`workspace-${tabId}`}
              id={`workspace-${tabId}-tab`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onActivateTab(tabId)}
              onKeyDown={(event) => onTabKeyDown?.(event, tabId)}
            >
              <AliIcon name="chat-bubble-plus" size={13} />
              <span>{t("sideChat.creating")}</span>
            </button>
          </div>
        );
      })}

      {contextMenu && menuTarget && typeof document !== "undefined" ? createPortal(
        <>
          <div className={sideStyles.tabMenuBackdrop} onMouseDown={() => setContextMenu(null)} />
          <div
            className={sideStyles.tabContextMenu}
            role="menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setContextMenu(null);
                setRenameValue(menuTarget.isDefaultTitle ? "" : menuTarget.title);
                setRenamingId(menuTarget.id);
              }}
            >
              <AliIcon name="compose" size={13} />
              <span>{t("sideChat.action.rename")}</span>
            </button>
            {menuTarget.storage === "attached" ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setContextMenu(null);
                  void sideChat.onToggleArchive(menuTarget.id, !menuTarget.archived);
                }}
              >
                <AliIcon name="archive" size={13} />
                <span>{t(menuTarget.archived ? "sideChat.action.unarchive" : "sideChat.action.archive")}</span>
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setContextMenu(null);
                void sideChat.onPromote(menuTarget.id);
              }}
            >
              <AliIcon name="external-link" size={13} />
              <span>{t("sideChat.action.promote")}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-danger="true"
              onClick={() => {
                setContextMenu(null);
                void sideChat.onDelete(menuTarget.id);
              }}
            >
              <AliIcon name="delete" size={13} />
              <span>{t("sideChat.action.delete")}</span>
            </button>
          </div>
        </>,
        document.body,
      ) : null}
    </>
  );
}

export function SideChatTabPanels({
  sideChat,
  panelActive,
  activeTab,
  panelClassName,
}: {
  sideChat?: RightPanelSideChatProps;
  panelActive: boolean;
  activeTab: string;
  panelClassName: string;
}) {
  const { t } = useI18n();
  if (!sideChat?.enabled) return null;

  return (
    <>
      {sideChat.errorBanner ? (
        <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, #dc2626 10%, var(--bg-panel))", color: "#dc2626", fontSize: "var(--text-xs)" }}>
          <span>{sideChat.errorBanner}</span>
          {sideChat.onDismissError ? (
            <button type="button" aria-label={t("i18n.close")} onClick={sideChat.onDismissError} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 2 }}>
              <AliIcon name="close" size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
      {sideChat.openIds.map((sideId) => {
        const item = sideChat.items.find((candidate) => candidate.id === sideId);
        if (!item) return null;
        const tabId = toSideChatTabId(sideId);
        const visible = panelActive && activeTab === tabId;
        return (
          <section
            key={tabId}
            id={`workspace-${tabId}`}
            role="tabpanel"
            aria-labelledby={`workspace-${tabId}-tab`}
            hidden={activeTab !== tabId}
            className={panelClassName}
          >
            <RenderErrorBoundary resetKey={tabId} fallbackLabel={t("workspace.panelRenderFailed")}>
              <SideChatTabView
                sideChat={item}
                active={visible}
                parentSnapshot={sideChat.parentSnapshot}
                parentRunning={sideChat.parentRunning}
                launchPayload={sideChat.pendingLaunchBySideId.get(sideId)}
                onConsumeLaunch={sideChat.onConsumeLaunch}
                onJumpToParent={sideChat.onJumpToParent}
                onRestartExpired={sideChat.onRestartExpired}
                onOpenFile={sideChat.onOpenFile}
                onAgentEnd={sideChat.onAgentEnd}
                onActivityChange={sideChat.onActivityChange}
              />
            </RenderErrorBoundary>
          </section>
        );
      })}

      {sideChat.pendingCreates.map((entry) => {
        const tabId = toSideChatLoadingTabId(entry.clientId);
        return (
          <section
            key={tabId}
            id={`workspace-${tabId}`}
            role="tabpanel"
            aria-labelledby={`workspace-${tabId}-tab`}
            hidden={activeTab !== tabId}
            className={panelClassName}
          >
            <SideChatTabView
              loadingEntry={entry}
              active={panelActive && activeTab === tabId}
              parentSnapshot={sideChat.parentSnapshot}
              parentRunning={sideChat.parentRunning}
              onJumpToParent={sideChat.onJumpToParent}
              onRestartExpired={sideChat.onRestartExpired}
              onAgentEnd={sideChat.onAgentEnd}
            />
          </section>
        );
      })}
    </>
  );
}
