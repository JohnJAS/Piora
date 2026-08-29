"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { SessionFlag, SessionFlags } from "@/lib/session-flags";
import type { SessionInfo } from "@/lib/types";
import type { SessionTreeNode } from "@/lib/session-project-groups";
import { applySessionOrder } from "./sidebar-utils";
import styles from "../SessionSidebar.module.css";
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
  sessionOrder: readonly string[];
}

const SESSION_DRAG_HOLD_MS = 250;
const SESSION_DRAG_CANCEL_DISTANCE = 7;

interface SessionDragState {
  sourceId: string;
  sourceScope: string;
  targetId: string | null;
  position: "before" | "after";
}

export function TaskList({ nodes, scope, onReorderSessions, ...props }: CommonProps & {
  nodes: SessionTreeNode[];
  scope: string;
  onReorderSessions: (sourceId: string, targetId: string, position: "before" | "after") => void;
}) {
  const activeNodes = useMemo(() => withoutArchivedNodes(nodes, props.flags), [nodes, props.flags]);
  const ordered = applySessionOrder(
    [...activeNodes].sort((left, right) => compareFlags(props.flags[left.session.id], props.flags[right.session.id])),
    props.sessionOrder,
    (node) => node.session.id,
    (node) => Boolean(props.flags[node.session.id]?.pinned),
  );
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidateRef = useRef<{ pointerId: number; sessionId: string; scope: string; x: number; y: number; scroll: HTMLElement | null; element: HTMLElement } | null>(null);
  const dragRef = useRef<SessionDragState | null>(null);
  const suppressClickRef = useRef<{ sessionId: string; until: number } | null>(null);
  const previousBodyStyleRef = useRef<{ cursor: string; userSelect: string } | null>(null);
  const [dragState, setDragState] = useState<SessionDragState | null>(null);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }, []);

  const stopDragging = useCallback(() => {
    clearHoldTimer();
    const candidate = candidateRef.current;
    if (candidate?.element.hasPointerCapture(candidate.pointerId)) {
      candidate.element.releasePointerCapture(candidate.pointerId);
    }
    candidateRef.current = null;
    dragRef.current = null;
    setDragState(null);
    if (previousBodyStyleRef.current) {
      document.body.style.cursor = previousBodyStyleRef.current.cursor;
      document.body.style.userSelect = previousBodyStyleRef.current.userSelect;
      previousBodyStyleRef.current = null;
    }
  }, [clearHoldTimer]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const candidate = candidateRef.current;
    if (!candidate || event.pointerId !== candidate.pointerId) return;
    event.stopPropagation();
    const activeDrag = dragRef.current;
    if (!activeDrag) {
      if (Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > SESSION_DRAG_CANCEL_DISTANCE) {
        stopDragging();
      }
      return;
    }

    event.preventDefault();
    const scroll = candidate.scroll;
    if (scroll) {
      const bounds = scroll.getBoundingClientRect();
      if (event.clientY < bounds.top + 32) scroll.scrollTop -= 12;
      else if (event.clientY > bounds.bottom - 32) scroll.scrollTop += 12;
    }

    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest<HTMLElement>("[data-session-drag-id]");
    const targetId = target?.dataset.sessionDragId ?? null;
    const targetScope = target?.dataset.sessionDragScope ?? null;
    if (!target || !targetId || targetId === activeDrag.sourceId || targetScope !== activeDrag.sourceScope) {
      if (activeDrag.targetId !== null) {
        const next = { ...activeDrag, targetId: null };
        dragRef.current = next;
        setDragState(next);
      }
      return;
    }
    const row = target.querySelector<HTMLElement>(":scope > [data-session-drag-row]");
    const rect = (row ?? target).getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    if (activeDrag.targetId !== targetId || activeDrag.position !== position) {
      const next: SessionDragState = { ...activeDrag, targetId, position };
      dragRef.current = next;
      setDragState(next);
    }
  }, [stopDragging]);

  const finishPointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const candidate = candidateRef.current;
    if (!candidate || event.pointerId !== candidate.pointerId) return;
    event.stopPropagation();
    const activeDrag = dragRef.current;
    if (activeDrag) {
      suppressClickRef.current = { sessionId: activeDrag.sourceId, until: Date.now() + 500 };
      if (activeDrag.targetId) {
        onReorderSessions(activeDrag.sourceId, activeDrag.targetId, activeDrag.position);
      }
    }
    stopDragging();
  }, [onReorderSessions, stopDragging]);

  useEffect(() => stopDragging, [stopDragging]);

  const beginSessionDrag = useCallback((sessionId: string, sourceScope: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    if ((event.target as Element).closest("button, input, textarea, select, a, [role='menu'], [data-session-drag-ignore]")) return;
    event.stopPropagation();
    clearHoldTimer();
    event.currentTarget.setPointerCapture(event.pointerId);
    candidateRef.current = {
      pointerId: event.pointerId,
      sessionId,
      scope: sourceScope,
      x: event.clientX,
      y: event.clientY,
      scroll: event.currentTarget.closest<HTMLElement>("[data-session-drag-scroll]"),
      element: event.currentTarget,
    };
    holdTimerRef.current = setTimeout(() => {
      const candidate = candidateRef.current;
      if (!candidate || candidate.pointerId !== event.pointerId || candidate.sessionId !== sessionId) return;
      const next: SessionDragState = { sourceId: sessionId, sourceScope, targetId: null, position: "after" };
      dragRef.current = next;
      setDragState(next);
      previousBodyStyleRef.current = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      window.getSelection()?.removeAllRanges();
    }, SESSION_DRAG_HOLD_MS);
  }, [clearHoldTimer]);

  const suppressSessionClick = useCallback((sessionId: string, event: ReactMouseEvent<HTMLElement>) => {
    const suppressed = suppressClickRef.current;
    if (!suppressed || suppressed.sessionId !== sessionId || Date.now() > suppressed.until) return;
    suppressClickRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return (
    <>
      {ordered.map((node) => (
        <SessionTreeItem
          key={node.session.id}
          node={node}
          depth={0}
          scope={`${scope}:root:${props.flags[node.session.id]?.pinned ? "pinned" : "regular"}`}
          dragState={dragState}
          onPointerDown={beginSessionDrag}
          onPointerMove={handlePointerMove}
          onPointerEnd={finishPointer}
          onClickCapture={suppressSessionClick}
          {...props}
        />
      ))}
    </>
  );
}

export function SessionTreeItem({ node, depth, scope, dragState, onPointerDown, onPointerMove, onPointerEnd, onClickCapture, ...props }: CommonProps & {
  node: SessionTreeNode;
  depth: number;
  scope: string;
  dragState: SessionDragState | null;
  onPointerDown: (sessionId: string, scope: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClickCapture: (sessionId: string, event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;
  const flag = props.flags[node.session.id] ?? {};
  const orderedChildren = applySessionOrder(
    node.children,
    props.sessionOrder,
    (child) => child.session.id,
    (child) => Boolean(props.flags[child.session.id]?.pinned),
  );

  return (
    <div
      className={`${styles.sessionDragItem}${dragState?.sourceId === node.session.id ? ` ${styles.sessionDragging}` : ""}${dragState?.targetId === node.session.id && dragState.position === "before" ? ` ${styles.sessionDropBefore}` : ""}${dragState?.targetId === node.session.id && dragState.position === "after" ? ` ${styles.sessionDropAfter}` : ""}`}
      data-session-drag-id={node.session.id}
      data-session-drag-scope={scope}
      onPointerDown={(event) => onPointerDown(node.session.id, scope, event)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(event) => onClickCapture(node.session.id, event)}
    >
      <div data-session-drag-row style={{ position: "relative" }}>
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
      {hasChildren && !collapsed && orderedChildren.map((child) => (
        <SessionTreeItem
          key={child.session.id}
          node={child}
          depth={depth + 1}
          scope={`${scope}:children:${node.session.id}:${props.flags[child.session.id]?.pinned ? "pinned" : "regular"}`}
          dragState={dragState}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerEnd={onPointerEnd}
          onClickCapture={onClickCapture}
          {...props}
        />
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
