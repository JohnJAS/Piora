"use client";

import { useMemo } from "react";
import { useI18n } from "@/hooks/useI18n";
import { buildSessionTree } from "@/lib/session-project-groups";
import type { SessionFlags } from "@/lib/session-flags";
import type { SessionInfo } from "@/lib/types";
import { AliIcon } from "../AliIcon";
import styles from "../SessionSidebar.module.css";
import { TaskList } from "./TaskList";

interface Props {
  sessions: SessionInfo[];
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  sessionFlags: SessionFlags;
  onNewChat: () => void;
  onSelectSession: (session: SessionInfo) => void;
  onRenamed: () => void;
  onSessionDeleted: (session: SessionInfo) => void;
  onFlagChange: (session: SessionInfo, patch: { pinned?: boolean; archived?: boolean }) => void;
  onDuplicate: (session: SessionInfo) => void;
}

export function SidebarChatArea({
  sessions,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  sessionFlags,
  onNewChat,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  onFlagChange,
  onDuplicate,
}: Props) {
  const { t } = useI18n();
  const tree = useMemo(() => buildSessionTree(sessions), [sessions]);

  return (
    <section className={styles.chatSection} aria-label={t("sidebar.chats")}>
      <div className={`${styles.sectionLabel} ${styles.chatSectionHeader}`}>
        <span>{t("sidebar.chats")}</span>
        <button
          type="button"
          className={styles.rowAction}
          onClick={onNewChat}
          title={t("sidebar.newProjectlessChat")}
          aria-label={t("sidebar.newProjectlessChat")}
        >
          <AliIcon name="compose" size={14} />
        </button>
      </div>
      <div className={styles.chatSessionList}>
        {tree.length > 0 ? (
          <TaskList
            nodes={tree}
            selectedSessionId={selectedSessionId}
            runningSessionIds={runningSessionIds}
            unreadSessionIds={unreadSessionIds}
            flags={sessionFlags}
            onSelectSession={onSelectSession}
            onRenamed={onRenamed}
            onSessionDeleted={onSessionDeleted}
            onFlagChange={onFlagChange}
            onDuplicate={onDuplicate}
          />
        ) : (
          <p className={styles.chatEmpty}>{t("sidebar.noProjectlessChats")}</p>
        )}
      </div>
    </section>
  );
}
