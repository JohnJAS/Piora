"use client";

import { useContext } from "react";
import { useI18n } from "@/hooks/useI18n";
import { OpenSubagentContext, useSubagentQuery } from "@/hooks/useSubagents";
import { useRunningTaskSnapshots } from "@/hooks/useTaskStatus";
import type { SubagentListItem, SubagentListPage } from "@/lib/subagent-types";
import { AliIcon } from "../AliIcon";
import { formatSubagentDuration, useLiveSubagentElapsed } from "./format";
import styles from "./SubagentSessionBar.module.css";

function RunningSubagentPill({ item, onOpen }: { item: SubagentListItem; onOpen: () => void }) {
  const elapsed = useLiveSubagentElapsed(item);
  return (
    <button
      type="button"
      id={`piora-subagent-bar-${item.agentId}`}
      className={styles.pill}
      onClick={onOpen}
      title={item.currentActivity ? `${item.description} · ${item.currentActivity}` : item.description}
    >
      <AliIcon name="robot" size={12} />
      <span className={styles.pillTitle}>{item.description}</span>
      {item.currentActivity && <span className={styles.pillActivity}>{item.currentActivity}</span>}
      <span className={styles.pillTime}>{formatSubagentDuration(elapsed)}</span>
    </button>
  );
}

export function SubagentSessionBar({ sessionId }: { sessionId?: string }) {
  const { t } = useI18n();
  const openDetails = useContext(OpenSubagentContext);
  const snapshots = useRunningTaskSnapshots();
  const activeCount = sessionId
    ? snapshots.find(snapshot => snapshot.id === sessionId)?.runningSubagentCount ?? 0
    : 0;
  const list = useSubagentQuery<SubagentListPage>(
    activeCount > 0 ? sessionId : undefined,
    activeCount > 0 ? "view=list&offset=0" : undefined,
  );
  if (!sessionId || activeCount <= 0 || !openDetails) return null;

  const running = (list.data?.records ?? []).filter(item => item.status === "running");

  return (
    <div className={styles.bar} role="status" data-subagent-session-bar={sessionId}>
      <span className={styles.lead}>
        <span className={styles.dot} aria-hidden="true" />
        <span>{t("subagent.sessionBarRunning", { count: running.length || activeCount })}</span>
      </span>
      {running.length > 0 && (
        <div className={styles.pills}>
          {running.slice(0, 4).map(item => (
            <RunningSubagentPill
              key={item.agentId}
              item={item}
              onOpen={() => openDetails({ parentSessionId: item.parentSessionId, agentId: item.agentId }, `piora-subagent-bar-${item.agentId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
