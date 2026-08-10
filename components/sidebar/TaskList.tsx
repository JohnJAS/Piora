"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionFlag, SessionFlags } from "@/lib/session-flags";
import type { SessionInfo } from "@/lib/types";
import type { SessionTreeNode } from "@/lib/session-project-groups";
import { sessionMatchesSearch } from "@/lib/session-search";
import { AliIcon } from "../AliIcon";
import { TaskRow } from "./TaskRow";

interface CommonProps {
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  flags: SessionFlags;
  searchQuery?: string;
  projectLabel?: string;
  onSelectSession: (session: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (session: SessionInfo) => void;
  onFlagChange?: (session: SessionInfo, patch: { pinned?: boolean; archived?: boolean }) => void;
  onDuplicate?: (session: SessionInfo) => void;
}

export function TaskList({ nodes, ...props }: CommonProps & { nodes: SessionTreeNode[] }) {
  const { t } = useI18n();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const matchingNodes = useMemo(
    () => filterNodes(nodes, props.searchQuery ?? "", props.projectLabel ?? ""),
    [nodes, props.projectLabel, props.searchQuery],
  );
  const normal = matchingNodes.filter((node) => !props.flags[node.session.id]?.archived);
  const archived = matchingNodes.filter((node) => props.flags[node.session.id]?.archived);
  const ordered = [...normal].sort((left, right) => compareFlags(props.flags[left.session.id], props.flags[right.session.id]));

  return (
    <>
      {ordered.map((node) => <SessionTreeItem key={node.session.id} node={node} depth={0} {...props} />)}
      {archived.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setArchivedOpen((value) => !value)}
            aria-expanded={archivedOpen}
            style={{
              width: "calc(100% - 12px)", margin: "3px 6px", padding: "6px 8px",
              display: "flex", alignItems: "center", gap: 6, border: 0, borderRadius: 6,
              background: "transparent", color: "var(--text-dim)", cursor: "pointer",
              fontSize: "var(--text-xs)", textAlign: "left",
            }}
          >
            <AliIcon name="folder" size={12} />
            <span style={{ flex: 1 }}>{t("sidebar.archivedTasks")}</span>
            <span>{archived.length}</span>
            <AliIcon name="arrowdown" size={10} style={{ transform: archivedOpen ? "none" : "rotate(-90deg)" }} />
          </button>
          {archivedOpen && archived.map((node) => <SessionTreeItem key={node.session.id} node={node} depth={0} {...props} />)}
        </div>
      )}
    </>
  );
}

export function SessionTreeItem({ node, depth, ...props }: CommonProps & { node: SessionTreeNode; depth: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const flag = props.flags[node.session.id] ?? {};

  return (
    <div>
      <div style={{ position: "relative" }}>
        {depth > 0 && <div aria-hidden="true" style={{ position: "absolute", left: depth * 12 + 6, top: 0, bottom: 0, width: 1, background: "var(--border)", pointerEvents: "none" }} />}
        <TaskRow
          session={node.session}
          isSelected={node.session.id === props.selectedSessionId}
          isRunning={props.runningSessionIds.has(node.session.id)}
          isUnread={props.unreadSessionIds.has(node.session.id)}
          onClick={() => props.onSelectSession(node.session)}
          onRenamed={props.onRenamed}
          onDeleted={props.onSessionDeleted}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
          pinned={Boolean(flag.pinned)}
          archived={Boolean(flag.archived)}
          searchQuery={props.searchQuery}
          onTogglePinned={() => props.onFlagChange?.(node.session, { pinned: !flag.pinned })}
          onToggleArchived={() => props.onFlagChange?.(node.session, { archived: !flag.archived })}
          onDuplicate={() => props.onDuplicate?.(node.session)}
        />
      </div>
      {hasChildren && !collapsed && node.children.map((child) => (
        <SessionTreeItem key={child.session.id} node={child} depth={depth + 1} {...props} />
      ))}
    </div>
  );
}

function compareFlags(left: SessionFlag | undefined, right: SessionFlag | undefined): number {
  if (Boolean(left?.pinned) !== Boolean(right?.pinned)) return left?.pinned ? -1 : 1;
  return (right?.pinnedAt ?? "").localeCompare(left?.pinnedAt ?? "");
}

function filterNodes(nodes: SessionTreeNode[], query: string, projectLabel: string): SessionTreeNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return nodes;
  return nodes.flatMap((node) => {
    const children = filterNodes(node.children, query, projectLabel);
    const matches = sessionMatchesSearch(node.session, projectLabel, needle);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });
}
