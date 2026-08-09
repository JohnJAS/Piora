"use client";

import type { Dispatch, SetStateAction } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getProjectLabel, type SessionProjectGroup } from "@/lib/session-project-groups";
import type { SessionFlags } from "@/lib/session-flags";
import type { SessionInfo } from "@/lib/types";
import { AliIcon } from "../AliIcon";
import styles from "../SessionSidebar.module.css";
import { ProjectSessionGroup } from "./ProjectList";

interface Props {
  loading: boolean; error: string | null; projectsHovered: boolean;
  setProjectsHovered: Dispatch<SetStateAction<boolean>>;
  handleDefaultCwd: () => Promise<void>; handleCustomPathClick: () => void;
  projectGroups: SessionProjectGroup[]; searchedProjectGroups: SessionProjectGroup[];
  selectedProject: string | null; collapsedProjectKeys: Set<string>; expandedProjectSessionKeys: Set<string>;
  setCollapsedProjectKeys: Dispatch<SetStateAction<Set<string>>>;
  setExpandedProjectSessionKeys: Dispatch<SetStateAction<Set<string>>>;
  selectedSessionId: string | null; runningSessionIds: Set<string>; unreadSessionIds: Set<string>; attentionSessionIds: Set<string>;
  setSelectedCwd: Dispatch<SetStateAction<string | null>>; homeDir: string;
  handleSelectSessionFromList: (session: SessionInfo) => void; handleNewSessionInProject: (cwd: string) => void;
  loadSessions: (showLoading?: boolean) => Promise<void>; handleSessionDeletedWithUndo: (session: SessionInfo) => void;
  sessionFlags: SessionFlags; taskSearch: string;
  patchSessionFlag: (session: SessionInfo, patch: { pinned?: boolean; archived?: boolean }) => Promise<void>;
  duplicateSession: (session: SessionInfo) => Promise<void>; pinnedProjectRoots: Set<string>; projectAliases: Record<string, string>;
  togglePinnedProject: (root: string) => void; renameProject: (root: string, alias: string) => void; removeProject: (root: string) => void;
}

export function SidebarProjectArea(props: Props) {
  const { t } = useI18n();
  const { loading, error, projectsHovered, setProjectsHovered, handleDefaultCwd, handleCustomPathClick, projectGroups, searchedProjectGroups, selectedProject, collapsedProjectKeys, expandedProjectSessionKeys, setCollapsedProjectKeys, setExpandedProjectSessionKeys, selectedSessionId, runningSessionIds, unreadSessionIds, attentionSessionIds, setSelectedCwd, homeDir, handleSelectSessionFromList, handleNewSessionInProject, loadSessions, handleSessionDeletedWithUndo, sessionFlags, taskSearch, patchSessionFlag, duplicateSession, pinnedProjectRoots, projectAliases, togglePinnedProject, renameProject, removeProject } = props;
  return <>
      {/* Codex-style project folders with their conversations nested below. */}
      <div className="sidebar-project-scroll" style={{ flex: "1 1 auto", overflowY: "auto", padding: "4px 0 8px", minHeight: 80 }}>
        {!loading && !error && (
          <div
            className={`${styles.sectionLabel} ${styles.projectsHeader}`}
            onMouseEnter={() => setProjectsHovered(true)}
            onMouseLeave={() => setProjectsHovered(false)}
          >
            <span>{t("sidebar.projects")}</span>
            <div className={styles.sectionLabelActions} style={{ opacity: projectsHovered ? 1 : 0 }}>
              <button
                type="button"
                className={styles.rowAction}
                onClick={() => void handleDefaultCwd()}
                title={t("sidebar.useDefaultDirectory")}
                aria-label={t("sidebar.useDefaultDirectory")}
              >
                <AliIcon name="home" size={12} />
              </button>
              <button
                type="button"
                className={styles.rowAction}
                onClick={handleCustomPathClick}
                title={t("sidebar.newProject")}
                aria-label={t("sidebar.newProject")}
              >
                <AliIcon name="plus" size={12} />
              </button>
            </div>
          </div>
        )}
        {loading && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            {t("sidebar.loading")}
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "#f87171", fontSize: "var(--text-sm)" }}>
            {error}
          </div>
        )}
        {!loading && !error && projectGroups.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            {t("sidebar.noSessions")}
          </div>
        )}
        {searchedProjectGroups.map((group) => (
          <ProjectSessionGroup
            key={group.key}
            group={group}
            homeDir={homeDir}
            isSelectedProject={selectedProject === group.projectRoot}
            isCollapsed={collapsedProjectKeys.has(group.key)}
            sessionsExpanded={expandedProjectSessionKeys.has(group.key)}
            selectedSessionId={selectedSessionId}
            runningSessionIds={runningSessionIds}
            unreadSessionIds={unreadSessionIds}
            attentionSessionIds={attentionSessionIds}
            onSelectProject={() => {
              setSelectedCwd(group.preferredCwd);
              setCollapsedProjectKeys((previous) => {
                const next = new Set(previous);
                next.delete(group.key);
                return next;
              });
            }}
            onToggleProject={() => {
              setCollapsedProjectKeys((previous) => {
                const next = new Set(previous);
                if (next.has(group.key)) next.delete(group.key);
                else next.add(group.key);
                return next;
              });
            }}
            onToggleSessions={() => {
              setExpandedProjectSessionKeys((previous) => {
                const next = new Set(previous);
                if (next.has(group.key)) next.delete(group.key);
                else next.add(group.key);
                return next;
              });
            }}
            onSelectSession={handleSelectSessionFromList}
            onNewSession={handleNewSessionInProject}
            onRenamed={() => loadSessions()}
            onSessionDeleted={handleSessionDeletedWithUndo}
            sessionFlags={sessionFlags}
            searchQuery={taskSearch}
            onFlagChange={patchSessionFlag}
            onDuplicateSession={duplicateSession}
            isPinned={pinnedProjectRoots.has(group.projectRoot)}
            displayLabel={projectAliases[group.projectRoot] ?? getProjectLabel(group.projectRoot)}
            onTogglePinned={() => togglePinnedProject(group.projectRoot)}
            onRenameProject={(alias) => renameProject(group.projectRoot, alias)}
            onRemoveProject={() => removeProject(group.projectRoot)}
          />
        ))}
      </div>

  </>;
}
