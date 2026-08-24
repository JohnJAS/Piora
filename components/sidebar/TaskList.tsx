"use client";

import { useMemo, useState } from "react";
import type { SessionFlag, SessionFlags } from "@/lib/session-flags";
import type { SessionInfo } from "@/lib/types";
import type { SessionTreeNode } from "@/lib/session-project-groups";
import { TaskRow } from "./TaskRow";

interface CommonProps {
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  flags: SessionFlags;
  onSelectSession: (session: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (session: SessionInfo) => void;
  onFlagChange?: (session: SessionInfo, patch: { pinned?: boolean; archived?: boolean }) => void;
  onDuplicate?: (session: SessionInfo) => void;
}

export function TaskList({ nodes, ...props }: CommonProps & { nodes: SessionTreeNode[] }) {
  const activeNodes = useMemo(() => withoutArchivedNodes(nodes, props.flags), [nodes, props.flags]);
  const ordered = [...activeNodes].sort((left, right) => compareFlags(props.flags[left.session.id], props.flags[right.session.id]));

  return (
    <>
      {ordered.map((node) => <SessionTreeItem key={node.session.id} node={node} depth={0} {...props} />)}
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
          archived={false}
          onTogglePinned={() => props.onFlagChange?.(node.session, { pinned: !flag.pinned })}
          onToggleArchived={() => props.onFlagChange?.(node.session, { archived: true })}
          onDuplicate={() => props.onDuplicate?.(node.session)}
        />
      </div>
      {hasChildren && !collapsed && node.children.map((child) => (
        <SessionTreeItem key={child.session.id} node={child} depth={depth + 1} {...props} />
      ))}
    </div>
  );
}

function withoutArchivedNodes(nodes: SessionTreeNode[], flags: SessionFlags): SessionTreeNode[] {
  return nodes.flatMap((node) => {
    const children = withoutArchivedNodes(node.children, flags);
    if (flags[node.session.id]?.archived) return children;
    return [{ ...node, children }];
  });
}

function compareFlags(left: SessionFlag | undefined, right: SessionFlag | undefined): number {
  if (Boolean(left?.pinned) !== Boolean(right?.pinned)) return left?.pinned ? -1 : 1;
  return (right?.pinnedAt ?? "").localeCompare(left?.pinnedAt ?? "");
}
