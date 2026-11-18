"use client";

import { useContext, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SubagentSidebarContext, useSubagentQuery } from "@/hooks/useSubagents";
import type { FlatTask } from "@/lib/sidebar-tree-window";
import type { SubagentListItem, SubagentListPage } from "@/lib/subagent-types";
import { AliIcon } from "../AliIcon";
import styles from "./SubagentTreeRows.module.css";

export function SubagentTreeRows({ row }: { row: FlatTask }) {
  const { t } = useI18n();
  const sidebar = useContext(SubagentSidebarContext);
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const parent = row.session.id;
  const active = sidebar?.activeCounts.get(parent) ?? 0;
  const known = sidebar?.parentIds.has(parent) || active > 0;
  const list = useSubagentQuery<SubagentListPage>(known && expanded ? parent : undefined,
    known && expanded ? "view=list&offset=" + offset : undefined);
  if (!sidebar?.open || !known) return null;
  const count = list.data?.total;
  const level = Math.min(row.depth, 5) + 2;
  const open = sidebar.open;
  const selected = sidebar.selected;
  const choose = (item: SubagentListItem) => open(row.session, item.agentId);
  const toggle = () => { setExpanded(!expanded); setOffset(0); };

  return <div role="none" className={styles.tree} style={{ "--subagent-depth": level - 1 } as CSSProperties}>
    <button type="button" role="treeitem" aria-level={level} aria-expanded={expanded} aria-selected={false} className={styles.row}
      data-subagent-group={parent} onClick={toggle}
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
      }}>
      <AliIcon name="chevron-right" size={11} className={expanded ? styles.expanded : undefined} />
      <AliIcon name="robot" size={13} />
      <span className={styles.label}>{count ? t("subagent.groupCount", { count }) : t("subagent.group")}</span>
      {active > 0 && <span className={styles.active}>{t("subagent.runningCount", { count: active })}</span>}
    </button>
    {expanded && <div role="group" className={styles.children}>
      {list.failed && <button type="button" className={styles.notice} onClick={list.refresh}>{t("subagent.refreshError")}</button>}
      {!list.data && !list.failed && <p className={styles.notice} role="status">{t("subagent.loadingList")}</p>}
      {list.data?.total === 0 && <p className={styles.notice}>{t("subagent.empty")}</p>}
      {list.data?.records.map(item => {
        const isSelected = selected?.parentSessionId === parent && selected.agentId === item.agentId;
        return <button type="button" role="treeitem" aria-level={level + 1} aria-selected={isSelected} className={styles.row}
          data-subagent-row={item.agentId} data-status={item.status} key={item.agentId} title={item.description}
          onClick={() => choose(item)} onKeyDown={event => {
            const target = event.currentTarget;
            let next: HTMLElement | null | undefined;
            if (event.key === "ArrowLeft") next = target.parentElement?.parentElement?.querySelector("[data-subagent-group]");
            else if (event.key === "ArrowUp") next = target.previousElementSibling?.hasAttribute("data-subagent-row") ? target.previousElementSibling as HTMLElement
              : target.parentElement?.parentElement?.querySelector("[data-subagent-group]");
            else if (event.key === "ArrowDown" && target.nextElementSibling?.hasAttribute("data-subagent-row")) next = target.nextElementSibling as HTMLElement;
            if (next) { event.preventDefault(); next.focus(); }
          }}>
          <span className={styles.label}>{item.description}</span>
          <span className={styles.status} data-status={item.status}><i aria-hidden="true" />{t("subagent." + item.status)}</span>
        </button>;
      })}
      {offset > 0 && <button type="button" className={styles.notice} onClick={() => setOffset(Math.max(0, offset - 20))}>{t("subagent.previous")}</button>}
      {typeof list.data?.nextOffset === "number" && <button type="button" className={styles.notice} onClick={() => setOffset(list.data!.nextOffset!)}>{t("subagent.more")}</button>}
    </div>}
  </div>;
}
