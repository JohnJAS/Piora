"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { getVisibleSessionRoots, type SessionProjectGroup as SessionProjectGroupData } from "@/lib/session-project-groups";
import type { SessionFlags } from "@/lib/session-flags";
import type { SessionInfo } from "@/lib/types";
import { AliIcon } from "../AliIcon";
import styles from "../SessionSidebar.module.css";
import { RunningSessionIndicator, UnreadSessionIndicator } from "./TaskRow";
import { TaskList } from "./TaskList";

function displayCwd(cwd: string, homeDir?: string): string {
  return homeDir && cwd.startsWith(homeDir) ? "~" + cwd.slice(homeDir.length) : cwd;
}

export function ProjectSessionGroup({
  group,
  homeDir,
  isSelectedProject,
  isCollapsed,
  sessionsExpanded,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  attentionSessionIds,
  onSelectProject,
  onToggleProject,
  onToggleSessions,
  onSelectSession,
  onNewSession,
  onRenamed,
  onSessionDeleted,
  sessionFlags,
  searchQuery,
  onFlagChange,
  onDuplicateSession,
  isPinned,
  displayLabel,
  onTogglePinned,
  onRenameProject,
  onRemoveProject,
}: {
  group: SessionProjectGroupData;
  homeDir: string;
  isSelectedProject: boolean;
  isCollapsed: boolean;
  sessionsExpanded: boolean;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  attentionSessionIds: Set<string>;
  onSelectProject: () => void;
  onToggleProject: () => void;
  onToggleSessions: () => void;
  onSelectSession: (session: SessionInfo) => void;
  onNewSession?: (cwd: string) => void;
  onRenamed: () => void;
  onSessionDeleted: (session: SessionInfo) => void;
  sessionFlags: SessionFlags;
  searchQuery: string;
  onFlagChange: (session: SessionInfo, patch: { pinned?: boolean; archived?: boolean }) => void;
  onDuplicateSession: (session: SessionInfo) => void;
  isPinned: boolean;
  displayLabel: string;
  onTogglePinned: () => void;
  onRenameProject: (alias: string) => void;
  onRemoveProject: () => void;
}) {
  const { t } = useI18n();
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  // Collapsing is purely presentational. Background agents keep running and
  // report their state on the project row without forcing the folder open.
  const projectOpen = !isCollapsed;
  const visibleRoots = getVisibleSessionRoots(group.tree, sessionsExpanded, attentionSessionIds);
  const hiddenRootCount = group.tree.length - visibleRoots.length;
  const runningCount = group.sessions.filter((session) => runningSessionIds.has(session.id)).length;
  const unreadCount = group.sessions.filter((session) => unreadSessionIds.has(session.id)).length;

  return (
    <section className={styles.projectGroup} aria-label={displayLabel}>
      <div className={`${styles.projectRow}${isSelectedProject ? ` ${styles.projectRowSelected}` : ""}`}>
        <button
          onClick={onToggleProject}
          title={projectOpen ? t("sidebar.collapseProject") : t("sidebar.expandProject")}
          aria-label={projectOpen ? t("sidebar.collapseProject") : t("sidebar.expandProject")}
          aria-expanded={projectOpen}
          className={styles.rowAction}
        >
          <AliIcon name={projectOpen ? "folder-open" : "folder"} size={15} />
        </button>

        <button
          onClick={() => {
            if (isSelectedProject) onToggleProject();
            else onSelectProject();
          }}
          title={group.projectRoot}
          className={styles.projectMain}
          aria-expanded={projectOpen}
        >
          <span className={styles.projectName}>{displayLabel}</span>
          {runningCount > 0 && <RunningSessionIndicator />}
          {runningCount === 0 && unreadCount > 0 && <UnreadSessionIndicator />}
        </button>
        <div className={styles.projectActions}>
          <button
            type="button"
            className={styles.rowAction}
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              setMenuAnchor({ x: rect.right + 6, y: rect.top - 4 });
            }}
            title={t("sidebar.projectMenu")}
            aria-label={t("sidebar.projectMenuFor", { project: displayLabel })}
            aria-expanded={menuAnchor !== null}
          >
            <AliIcon name="ellipsis" size={14} />
          </button>
          <button
            type="button"
            className={styles.rowAction}
            onClick={() => onNewSession?.(group.preferredCwd)}
            title={t("sidebar.newSessionTitle", { path: group.preferredCwd })}
            aria-label={t("sidebar.newSessionTitle", { path: group.preferredCwd })}
          >
            <AliIcon name="edit" size={13} />
          </button>
        </div>
      </div>

      {projectOpen && (
        <div className={styles.sessionList}>
          {group.tree.length === 0 && (
            <div style={{ padding: "8px 12px", color: "var(--text-dim)", fontSize: "var(--text-xs)" }}>
              {t("sidebar.noSessionsInProject")}
            </div>
          )}
          <TaskList
            nodes={visibleRoots}
            selectedSessionId={selectedSessionId}
            runningSessionIds={runningSessionIds}
            unreadSessionIds={unreadSessionIds}
            flags={sessionFlags}
            searchQuery={searchQuery}
            projectLabel={displayLabel}
            onSelectSession={onSelectSession}
            onRenamed={onRenamed}
            onSessionDeleted={onSessionDeleted}
            onFlagChange={onFlagChange}
            onDuplicate={onDuplicateSession}
          />
          {(hiddenRootCount > 0 || sessionsExpanded) && group.tree.length > 3 && (
            <button
              onClick={onToggleSessions}
              aria-expanded={sessionsExpanded}
              style={{
                width: "calc(100% - 12px)",
                margin: "2px 6px",
                padding: "6px 10px",
                border: "none",
                borderRadius: "var(--radius-control)",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: "var(--text-xs)",
              }}
            >
              {sessionsExpanded
                ? t("sidebar.showFewerSessions")
                : t("sidebar.showMoreSessions", { count: hiddenRootCount })}
            </button>
          )}
        </div>
      )}
      {menuAnchor && createPortal(
        <ProjectContextMenu
          anchor={menuAnchor}
          group={group}
          displayLabel={displayLabel}
          homeDir={homeDir}
          runningCount={runningCount}
          isPinned={isPinned}
          onTogglePinned={onTogglePinned}
          onRenameProject={onRenameProject}
          onRemoveProject={onRemoveProject}
          onNewSession={() => onNewSession?.(group.preferredCwd)}
          onClose={() => setMenuAnchor(null)}
        />,
        document.body,
      )}
    </section>
  );
}

function ProjectContextMenu({
  anchor,
  group,
  displayLabel,
  homeDir,
  runningCount,
  isPinned,
  onTogglePinned,
  onRenameProject,
  onRemoveProject,
  onNewSession,
  onClose,
}: {
  anchor: { x: number; y: number };
  group: SessionProjectGroupData;
  displayLabel: string;
  homeDir: string;
  runningCount: number;
  isPinned: boolean;
  onTogglePinned: () => void;
  onRenameProject: (alias: string) => void;
  onRemoveProject: () => void;
  onNewSession: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState(displayLabel);
  const [metadata, setMetadata] = useState<{ repository?: string; branch?: string } | null>(null);

  useEffect(() => {
    const closeOnPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/project-info?cwd=${encodeURIComponent(group.preferredCwd)}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ repository?: string; branch?: string }> : null)
      .then((value) => { if (value) setMetadata(value); })
      .catch(() => {});
    return () => controller.abort();
  }, [group.preferredCwd]);

  const commitAlias = () => {
    onRenameProject(alias);
    setEditing(false);
  };
  const left = Math.max(8, Math.min(anchor.x, window.innerWidth - 330));
  const top = Math.max(8, Math.min(anchor.y, window.innerHeight - 270));

  return (
    <div ref={menuRef} className={styles.projectMenu} role="menu" aria-label={t("sidebar.projectMenuFor", { project: displayLabel })} style={{ left, top }}>
      <div className={styles.projectMenuHeader}>
        <AliIcon name="folder" size={16} />
        <span className={styles.ellipsis} style={{ flex: 1 }}>{displayLabel}</span>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => { onTogglePinned(); onClose(); }}
          title={isPinned ? t("sidebar.unpinProject") : t("sidebar.pinProject")}
          aria-label={isPinned ? t("sidebar.unpinProject") : t("sidebar.pinProject")}
        >
          <AliIcon name="pushpin" size={14} style={{ color: isPinned ? "var(--accent)" : undefined }} />
        </button>
      </div>
      <div className={`${styles.menuItem} ${styles.menuItemMuted}`}>
        <AliIcon name="message" size={14} />
        <span>{t("sidebar.projectTaskSummary", { count: group.sessions.length, running: runningCount })}</span>
      </div>
      <div className={styles.menuDivider} />
      {metadata?.repository && (
        <div className={styles.menuItem} title={metadata.repository}>
          <AliIcon name="code" size={14} />
          <span className={styles.ellipsis}>{metadata.repository}</span>
        </div>
      )}
      <div className={styles.menuItem} title={group.projectRoot}>
        <AliIcon name="folder" size={14} />
        <span className={styles.ellipsis}>{displayCwd(group.projectRoot, homeDir)}</span>
      </div>
      {metadata?.branch && (
        <div className={`${styles.menuItem} ${styles.menuItemMuted}`} title={metadata.branch}>
          <AliIcon name="branches" size={14} />
          <span className={styles.ellipsis}>{metadata.branch}</span>
        </div>
      )}
      <div className={styles.menuDivider} />
      {editing ? (
        <div style={{ padding: "3px 5px 5px" }}>
          <input
            ref={inputRef}
            className={styles.menuRenameInput}
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            onBlur={commitAlias}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitAlias();
              if (event.key === "Escape") { setEditing(false); setAlias(displayLabel); }
            }}
            aria-label={t("sidebar.projectName")}
            autoFocus
          />
        </div>
      ) : (
        <button type="button" className={styles.menuItem} role="menuitem" onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.select(), 0); }}>
          <AliIcon name="setting" size={14} />
          <span>{t("sidebar.editProject")}</span>
        </button>
      )}
      <button type="button" className={styles.menuItem} role="menuitem" onClick={() => { onNewSession(); onClose(); }}>
        <AliIcon name="edit" size={14} />
        <span>{t("sidebar.newChat")}</span>
      </button>
      <button
        type="button"
        className={styles.menuItem}
        role="menuitem"
        onClick={() => { onRemoveProject(); onClose(); }}
        title={t("sidebar.removeProjectDescription")}
        style={{ color: "#ef4444" }}
      >
        <AliIcon name="delete" size={14} />
        <span>{t("sidebar.removeProject")}</span>
      </button>
    </div>
  );
}
