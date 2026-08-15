"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollaborationRoom } from "@/lib/room-types";
import type { SessionInfo } from "@/lib/types";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { AliIcon } from "./AliIcon";
import styles from "./RoomSidebarSection.module.css";

type RoomsResponse = { rooms?: CollaborationRoom[]; room?: CollaborationRoom; error?: string };

function sessionLabel(session: SessionInfo): string {
  return session.name?.trim() || session.firstMessage?.trim().slice(0, 56) || session.id.slice(0, 8);
}

function sessionProject(session: SessionInfo): string {
  return session.projectRoot ?? session.cwd;
}

export function RoomSidebarSection({
  sessions,
  selectedSessionId,
  selectedRoomId,
  activeProjectRoot,
  initialRoomId,
  onSelectRoom,
  onInitialRestoreDone,
}: {
  sessions: SessionInfo[];
  selectedSessionId: string | null;
  selectedRoomId: string | null;
  activeProjectRoot?: string | null;
  initialRoomId?: string | null;
  onSelectRoom: (room: CollaborationRoom, isRestore?: boolean) => void;
  onInitialRestoreDone?: () => void;
}) {
  const [rooms, setRooms] = useState<CollaborationRoom[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectRoot, setProjectRoot] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restoredRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useFocusTrap(dialogRef, createOpen, {
    initialFocus: nameInputRef,
    onEscape: busy ? undefined : () => setCreateOpen(false),
  });

  const loadRooms = useCallback(async () => {
    const response = await fetch("/api/rooms", { cache: "no-store" });
    const data = await response.json() as RoomsResponse;
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    setRooms(data.rooms ?? []);
    setLoaded(true);
    return data.rooms ?? [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => void loadRooms().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadRooms]);

  useEffect(() => {
    if (restoredRef.current || !initialRoomId) return;
    const target = rooms.find((room) => room.id === initialRoomId);
    if (target) {
      restoredRef.current = true;
      onSelectRoom(target, true);
      onInitialRestoreDone?.();
      return;
    }
    if (loaded) {
      restoredRef.current = true;
      onInitialRestoreDone?.();
    }
  }, [initialRoomId, loaded, onInitialRestoreDone, onSelectRoom, rooms]);

  const projectRoots = useMemo(() => {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const session of sessions) {
      const root = sessionProject(session);
      const key = root.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(root);
      }
    }
    return result;
  }, [sessions]);

  const projectSessions = useMemo(
    () => sessions.filter((session) => sessionProject(session).toLocaleLowerCase() === projectRoot.toLocaleLowerCase()),
    [projectRoot, sessions],
  );

  const openCreate = () => {
    const selectedSession = sessions.find((session) => session.id === selectedSessionId);
    const initialProject = selectedSession ? sessionProject(selectedSession) : activeProjectRoot ?? projectRoots[0] ?? "";
    setProjectRoot(initialProject);
    setSelectedIds(new Set(selectedSession ? [selectedSession.id] : []));
    setName("");
    setDescription("");
    setError(null);
    setCreateOpen(true);
  };

  const changeProject = (nextProject: string) => {
    setProjectRoot(nextProject);
    const selectedSession = sessions.find((session) => session.id === selectedSessionId && sessionProject(session).toLocaleLowerCase() === nextProject.toLocaleLowerCase());
    setSelectedIds(new Set(selectedSession ? [selectedSession.id] : []));
  };

  const toggleSession = (sessionId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  const createRoom = async () => {
    const selected = projectSessions.filter((session) => selectedIds.has(session.id));
    if (!name.trim() || selected.length === 0) return;
    const preferredCreator = selected.find((session) => session.id === selectedSessionId) ?? selected[0];
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          sessionId: preferredCreator.id,
          sessionName: sessionLabel(preferredCreator),
          cwd: preferredCreator.cwd,
          projectRoot: sessionProject(preferredCreator),
          members: selected.filter((session) => session.id !== preferredCreator.id).map((session) => ({
            sessionId: session.id,
            sessionName: sessionLabel(session),
            cwd: session.cwd,
            projectRoot: sessionProject(session),
            role: "participant",
          })),
        }),
      });
      const data = await response.json() as RoomsResponse;
      if (!response.ok || !data.room) throw new Error(data.error ?? `HTTP ${response.status}`);
      const nextRooms = await loadRooms();
      const created = nextRooms.find((room) => room.id === data.room?.id) ?? data.room;
      setCreateOpen(false);
      onSelectRoom(created);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-label="群聊">
      <div className={styles.heading}>
        <span>群聊</span>
        <button type="button" className={styles.addButton} onClick={openCreate} aria-label="新建群聊" title="新建群聊">
          <AliIcon name="plus" size={13} />
        </button>
      </div>
      <div className={styles.list}>
        {rooms.length === 0 ? <div className={styles.empty}>创建一个多 Session 群聊</div> : rooms.map((room) => (
          <button
            key={room.id}
            type="button"
            className={`${styles.roomRow}${room.id === selectedRoomId ? ` ${styles.selected}` : ""}`}
            onClick={() => onSelectRoom(room)}
          >
            <span className={styles.roomIcon} aria-hidden="true"><AliIcon name="message" size={14} /></span>
            <span className={styles.roomCopy}>
              <strong>{room.name}</strong>
              <small>{room.members.length} 个 Agent · {room.workspace.label}</small>
            </span>
          </button>
        ))}
      </div>
      {createOpen ? (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreateOpen(false); }}>
          <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="room-create-title">
            <div className={styles.dialogHeader}>
              <div>
                <h2 id="room-create-title">新建群聊</h2>
                <p>选择同一项目中的 Session；创建后可设置每个 Agent 的身份、职责和绑定。</p>
              </div>
              <button type="button" className={styles.closeButton} onClick={() => setCreateOpen(false)} aria-label="关闭" disabled={busy}>
                <AliIcon name="close" size={15} />
              </button>
            </div>
            <label className={styles.field}>
              <span>群名称</span>
              <input ref={nameInputRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Piora 重构讨论组" maxLength={120} />
            </label>
            <label className={styles.field}>
              <span>团队目标</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="这个 Agent 团队要完成什么，以及最终交付标准" rows={3} maxLength={2_000} />
            </label>
            <label className={styles.field}>
              <span>项目</span>
              <select value={projectRoot} onChange={(event) => changeProject(event.target.value)}>
                {projectRoots.map((root) => <option key={root} value={root}>{root}</option>)}
              </select>
            </label>
            <div className={styles.memberHeader}>
              <span>初始 Agent</span>
              <small>已选择 {selectedIds.size} 个 Session</small>
            </div>
            <div className={styles.members}>
              {projectSessions.map((session) => (
                <label key={session.id} className={styles.memberRow}>
                  <input type="checkbox" checked={selectedIds.has(session.id)} onChange={() => toggleSession(session.id)} />
                  <span className={styles.avatar}>{sessionLabel(session).slice(0, 1).toLocaleUpperCase()}</span>
                  <span className={styles.memberCopy}>
                    <strong>{sessionLabel(session)}</strong>
                    <small>{session.worktreeBranch ?? session.cwd}</small>
                  </span>
                </label>
              ))}
            </div>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <div className={styles.dialogActions}>
              <button type="button" onClick={() => setCreateOpen(false)} disabled={busy}>取消</button>
              <button type="button" className={styles.primary} onClick={() => { void createRoom(); }} disabled={busy || !name.trim() || selectedIds.size === 0}>
                {busy ? "创建中…" : "创建群聊"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {error && !createOpen ? <div className={styles.inlineError}>{error}</div> : null}
    </section>
  );
}
