"use client";

import { useCallback, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTaskStatus } from "@/hooks/useTaskStatus";
import {
  STATUS_PRESENTATION,
  getTaskStatusPresentationKey,
  type TaskStatus,
} from "@/lib/task-status";
import type { SessionInfo } from "@/lib/types";
import { AliIcon } from "../AliIcon";
import { TaskContextMenu } from "./TaskContextMenu";

export function TaskStatusIndicator({ status }: { status: TaskStatus }) {
  const { t } = useI18n();
  const presentationKey = getTaskStatusPresentationKey(status);
  if (presentationKey === "none") return null;
  const presentation = STATUS_PRESENTATION[presentationKey];
  const label = t(presentation.i18nKey);
  const color = `var(${presentation.colorVar})`;
  const spinning = presentationKey === "running";

  return (
    <span
      title={label}
      aria-label={label}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color,
      }}
    >
      {spinning ? (
        <span className="sidebar-running-spinner" aria-hidden="true" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
          <circle cx="7" cy="7" r={presentationKey === "unread" ? 2.5 : 3} fill="currentColor" />
          {presentationKey === "unread" ? (
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.25" opacity="0.38" />
          ) : null}
        </svg>
      )}
    </span>
  );
}

export function RunningSessionIndicator() {
  return <TaskStatusIndicator status={{ lifecycle: "active", runtime: "running", attention: "none" }} />;
}

export function UnreadSessionIndicator() {
  return <TaskStatusIndicator status={{ lifecycle: "active", runtime: "idle", attention: "unread" }} />;
}

export function TaskRow({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
  pinned = false,
  archived = false,
  searchQuery = "",
  onTogglePinned,
  onToggleArchived,
  onDuplicate,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (session: SessionInfo) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  pinned?: boolean;
  archived?: boolean;
  searchQuery?: string;
  onTogglePinned?: () => void;
  onToggleArchived?: () => void;
  onDuplicate?: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const taskStatus = useTaskStatus({
    sessionId: session.id,
    isViewing: isSelected,
    hasUnreadResult: Boolean(isUnread),
    fallbackRuntime: isRunning ? "running" : "idle",
  });
  const taskStatusPresentationKey = getTaskStatusPresentationKey(taskStatus);
  const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const matchIndex = normalizedQuery ? title.toLocaleLowerCase().indexOf(normalizedQuery) : -1;

  const startRename = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setRenameValue(session.name ?? "");
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // Preserve the current row and let the next refresh retry.
    }
  }, [onRenamed, renameValue, session.id, session.name]);

  const performDelete = useCallback(async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session);
    } catch {
      setDeleting(false);
    }
  }, [onDeleted, session]);

  const handleDeleteClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    void performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const itemHeight = "max(31px, calc(var(--text-sm) + 16px))";
  const rowBackground = confirmDelete
    ? "color-mix(in srgb, var(--status-failed) 6%, transparent)"
    : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent";

  return (
    <div
      className={`sidebar-session-row${isSelected ? " is-selected" : ""}`}
      onClick={confirmDelete || renaming ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuAnchor({ x: event.clientX, y: event.clientY });
      }}
      style={{
        position: "relative",
        height: itemHeight,
        width: "calc(100% - 12px)",
        margin: "2px 6px",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 8 : 8,
        paddingRight: 5,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: rowBackground,
        border: "1px solid transparent",
        borderRadius: 7,
        transition: "background 0.1s, border-color 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: "var(--text-sm)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("sidebar.deleteSession", { title: title.slice(0, 22) + (title.length > 22 ? "…" : "") })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                minHeight: "max(26px, calc(var(--text-sm) + 14px))", padding: "0 8px",
                background: "var(--status-failed)", border: "none",
                borderRadius: 6, color: "var(--bg)", cursor: "pointer",
                fontSize: "var(--text-sm)", fontWeight: 600, whiteSpace: "nowrap",
              }}
            >
              <AliIcon name="delete" size={12} />
              {t("sidebar.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                minHeight: "max(26px, calc(var(--text-sm) + 14px))", padding: "0 8px",
                background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-muted)", cursor: "pointer", fontSize: "var(--text-sm)",
                fontWeight: 500, whiteSpace: "nowrap",
              }}
            >
              {t("sidebar.cancel")}
            </button>
          </div>
        </>
      ) : renaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") void commitRename();
            if (event.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1, fontSize: "var(--text-sm)", padding: "5px 8px",
            border: "1px solid var(--accent)", borderRadius: 5, outline: "none",
            background: "var(--bg)", color: "var(--text)",
            minHeight: "max(28px, calc(var(--text-sm) + 16px))",
          }}
        />
      ) : (
        <>
          {depth > 0 ? <AliIcon name="fork" size={10} style={{ color: "var(--text-dim)" }} /> : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, fontSize: "var(--text-sm)", fontWeight: isSelected ? 500 : 400, lineHeight: 1.4, color: "var(--text)" }}
              title={title}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {matchIndex < 0 ? title : (
                  <>{title.slice(0, matchIndex)}<mark style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", color: "inherit", borderRadius: 2 }}>{title.slice(matchIndex, matchIndex + normalizedQuery.length)}</mark>{title.slice(matchIndex + normalizedQuery.length)}</>
                )}
              </span>
            </div>
          </div>

          {pinned ? (
            <span title={t("sidebar.pinned")} aria-label={t("sidebar.pinned")} style={{ color: "var(--accent)", display: "inline-flex", flexShrink: 0 }}>
              <AliIcon name="pushpin" size={11} />
            </span>
          ) : null}

          {taskStatusPresentationKey !== "none" ? (
            <TaskStatusIndicator status={taskStatus} />
          ) : null}
          {taskStatusPresentationKey === "none" && session.worktreeBranch ? (
            <span title={`Worktree: ${session.worktreeBranch}`} style={{ color: "var(--text-dim)", display: "inline-flex" }}>
              <AliIcon name="branches" size={11} />
            </span>
          ) : null}

          {hasChildren ? (
            <button
              onClick={(event) => { event.stopPropagation(); onToggleCollapse?.(); }}
              title={collapsed ? t("sidebar.expandForks") : t("sidebar.collapseForks")}
              aria-label={collapsed ? t("sidebar.expandForks") : t("sidebar.collapseForks")}
              aria-expanded={!collapsed}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, padding: 0, flexShrink: 0, background: "none",
                border: "none", color: "var(--text-dim)", cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s",
              }}
            >
              <AliIcon name="arrowdown" size={10} />
            </button>
          ) : null}

          {/* Action buttons stay absolutely positioned so hover never reflows the row. */}
          <div
            aria-hidden={!hovered}
            style={{
              position: "absolute", right: 4, top: 0, bottom: 0, zIndex: 2,
              display: "flex", alignItems: "center", gap: 4, paddingLeft: 14,
              opacity: hovered ? 1 : 0, visibility: hovered ? "visible" : "hidden",
              pointerEvents: hovered ? "auto" : "none",
              background: `linear-gradient(to right, transparent, ${isSelected ? "var(--bg-selected)" : "var(--bg-hover)"} 38%)`,
            }}
          >
            <RowActionButton label={t("sidebar.rename")} icon="edit" onClick={startRename} />
            <RowActionButton
              label={t("sidebar.delete")}
              icon="delete"
              danger
              onClick={handleDeleteClick}
            />
          </div>
        </>
      )}
      {menuAnchor && (
        <TaskContextMenu
          anchor={menuAnchor}
          session={session}
          pinned={pinned}
          archived={archived}
          onPin={() => onTogglePinned?.()}
          onRename={() => {
            setRenameValue(session.name ?? "");
            setRenaming(true);
            setTimeout(() => inputRef.current?.select(), 0);
          }}
          onArchive={() => onToggleArchived?.()}
          onDuplicate={() => onDuplicate?.()}
          onDelete={() => setConfirmDelete(true)}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </div>
  );
}

function RowActionButton({
  label,
  icon,
  danger = false,
  onClick,
}: {
  label: string;
  icon: "edit" | "delete";
  danger?: boolean;
  onClick: (event: React.MouseEvent) => void;
}) {
  const normalColor = "var(--text-muted)";
  const hoverColor = danger ? "var(--status-failed)" : "var(--accent)";
  const hoverBackground = danger
    ? "color-mix(in srgb, var(--status-failed) 8%, transparent)"
    : "var(--bg-selected)";
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 23, height: 23, padding: 0, background: "var(--bg-hover)",
        border: "none", borderRadius: 6, color: normalColor, cursor: "pointer",
        flexShrink: 0, transition: "background 0.12s, color 0.12s",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = hoverBackground;
        event.currentTarget.style.color = hoverColor;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "var(--bg-hover)";
        event.currentTarget.style.color = normalColor;
      }}
    >
      <AliIcon name={icon} size={14} />
    </button>
  );
}
