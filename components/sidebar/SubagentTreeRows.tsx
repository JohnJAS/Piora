"use client";

import { useContext, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SubagentSidebarContext, useSubagentQuery, type SubagentSidebarState } from "@/hooks/useSubagents";
import type { FlatTask } from "@/lib/sidebar-tree-window";
import type { SubagentListItem, SubagentListPage } from "@/lib/subagent-types";
import { AliIcon } from "../AliIcon";
import { formatSubagentDuration, useLiveSubagentElapsed } from "../subagents/format";
import styles from "./SubagentTreeRows.module.css";

function SubagentSidebarItem({
  item,
  level,
  isSelected,
  onChoose,
}: {
  item: SubagentListItem;
  level: number;
  isSelected: boolean;
  onChoose: (item: SubagentListItem) => void;
}) {
  const { t } = useI18n();
  const elapsed = useLiveSubagentElapsed(item);
  return (
    <button
      type="button"
      id={`piora-subagent-sidebar-${item.agentId}`}
      role="treeitem"
      aria-level={level}
      aria-selected={isSelected}
      className={styles.row}
      data-subagent-row={item.agentId}
      data-status={item.status}
      title={item.currentActivity ? `${item.description} · ${item.currentActivity}` : item.description}
      onClick={() => onChoose(item)}
      onKeyDown={event => {
        const target = event.currentTarget;
        let next: HTMLElement | null | undefined;
        if (event.key === "ArrowLeft") next = target.parentElement?.parentElement?.querySelector("[data-subagent-group]");
        else if (event.key === "ArrowUp") next = target.previousElementSibling?.hasAttribute("data-subagent-row")
          ? target.previousElementSibling as HTMLElement
          : target.parentElement?.parentElement?.querySelector("[data-subagent-group]");
        else if (event.key === "ArrowDown" && target.nextElementSibling?.hasAttribute("data-subagent-row")) {
          next = target.nextElementSibling as HTMLElement;
        }
        if (next) { event.preventDefault(); next.focus(); }
      }}
    >
      <span className={styles.dot} data-status={item.status} aria-hidden="true" />
      <span className={styles.label}>{item.description}</span>
      <span className={styles.status} data-status={item.status}>
        {item.status === "running" ? (
          <>
            <span className={styles.srOnly}>{t("subagent.running")} </span>
            {formatSubagentDuration(elapsed)}
          </>
        ) : t(`subagent.${item.status}`)}
      </span>
    </button>
  );
}

export function SubagentTreeRows({ row }: { row: FlatTask }) {
  const sidebar = useContext(SubagentSidebarContext);
  const active = sidebar?.activeCounts.get(row.session.id) ?? 0;
  if (!sidebar?.open || active === 0) return null;
  return <RunningSubagentRows row={row} active={active} open={sidebar.open} selected={sidebar.selected} />;
}

function RunningSubagentRows({ row, active, open, selected }: {
  row: FlatTask; active: number; open: NonNullable<SubagentSidebarState["open"]>; selected: SubagentSidebarState["selected"];
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const parent = row.session.id;
  const list = useSubagentQuery<SubagentListPage>(
    expanded ? parent : undefined,
    expanded ? "view=list&offset=0" : undefined,
  );
  const level = Math.min(row.depth, 5) + 2;
  const toggle = () => setExpanded(!expanded);
  const choose = (item: SubagentListItem) => open(row.session, item.agentId, `piora-subagent-sidebar-${item.agentId}`);

  return (
    <div role="none" className={styles.tree} style={{ "--subagent-depth": level - 1 } as CSSProperties}>
      <button
        type="button"
        role="treeitem"
        aria-level={level}
        aria-expanded={expanded}
        aria-selected={false}
        className={styles.row}
        data-subagent-group={parent}
        onClick={toggle}
        onKeyDown={event => {
          if ((event.key === "ArrowRight" && !expanded) || (event.key === "ArrowLeft" && expanded)) {
            event.preventDefault(); toggle();
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            event.currentTarget.closest("[data-session-tree-block]")?.querySelector<HTMLElement>("[data-session-drag-id]")?.focus();
          } else if ((event.key === "ArrowRight" || event.key === "ArrowDown") && expanded) {
            const next = event.currentTarget.parentElement?.querySelector<HTMLElement>("[data-subagent-row]");
            if (next) { event.preventDefault(); next.focus(); }
          }
        }}
      >
        <AliIcon name="chevron-right" size={12} className={`${styles.chevron}${expanded ? ` ${styles.expanded}` : ""}`} />
        <AliIcon name="robot" size={14} />
        <span className={styles.label}>{t("subagent.group")}</span>
        {active > 0 && (
          <span className={styles.active}>
            <span className={styles.dot} data-status="running" aria-hidden="true" />
            <span>{t("subagent.runningCount", { count: active })}</span>
          </span>
        )}
      </button>
      {expanded && (
        <div role="group" className={styles.children}>
          {list.failed && (
            <button type="button" className={styles.pagerBtn} onClick={list.refresh}>
              {t("subagent.refreshError")}
            </button>
          )}
          {!list.data && !list.failed && <p className={styles.notice} role="status">{t("subagent.loadingList")}</p>}
          {list.data?.total === 0 && <p className={styles.notice}>{t("subagent.empty")}</p>}
          {list.data?.records.filter(item => item.status === "running").map(item => (
            <SubagentSidebarItem
              key={item.agentId}
              item={item}
              level={level + 1}
              isSelected={selected?.parentSessionId === parent && selected.agentId === item.agentId}
              onChoose={choose}
            />
          ))}

        </div>
      )}
    </div>
  );
}
