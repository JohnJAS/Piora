"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollaborationRoom, RoomArtifact, RoomMessage, RoomTask } from "@/lib/room-types";
import { resolveRoomChatTargets } from "@/lib/room-chat-routing";
import { AliIcon } from "./AliIcon";
import { MarkdownBody } from "./MarkdownBody";
import { RoomSettingsDialog } from "./RoomSettingsDialog";
import styles from "./RoomWorkspace.module.css";

type RoomResponse = {
  room?: CollaborationRoom;
  messages?: RoomMessage[];
  tasks?: RoomTask[];
  artifacts?: RoomArtifact[];
  dispatch?: {
    dispatched?: Array<{ sessionId: string; behavior?: string; taskId?: string }>;
    skipped?: Array<{ sessionId?: string; taskId?: string; reason: string }>;
  };
  error?: string;
};

function memberName(room: CollaborationRoom, sessionId?: string): string {
  if (!sessionId) return "未分配";
  const member = room.members.find((item) => item.sessionId === sessionId);
  return member?.name || sessionId.slice(0, 8);
}

function initials(name?: string): string {
  return (name?.trim().slice(0, 1) || "π").toLocaleUpperCase();
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function roleLabel(role: CollaborationRoom["members"][number]["role"]): string {
  return ({ coordinator: "协调者", planner: "规划者", worker: "执行者", reviewer: "审查者", participant: "参与者" })[role];
}

export function RoomWorkspace({
  initialRoom,
  onRoomChange,
}: {
  initialRoom: CollaborationRoom;
  onRoomChange?: (room: CollaborationRoom) => void;
}) {
  const [room, setRoom] = useState(initialRoom);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [tasks, setTasks] = useState<RoomTask[]>([]);
  const [artifacts, setArtifacts] = useState<RoomArtifact[]>([]);
  const [draft, setDraft] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [detailsOverlay, setDetailsOverlay] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const updateRoom = useCallback((nextRoom: CollaborationRoom) => {
    setRoom(nextRoom);
    onRoomChange?.(nextRoom);
  }, [onRoomChange]);

  useEffect(() => {
    setRoom(initialRoom);
  }, [initialRoom]);

  useEffect(() => {
    setMessages([]);
    setTasks([]);
    setArtifacts([]);
    setDraft("");
    setError(null);
    setConnectionState("connecting");
    const roomId = initialRoom.id;
    const events = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/events`);
    events.onopen = () => {
      setConnectionState("connected");
      setError(null);
    };
    events.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RoomResponse & { type?: string; message?: RoomMessage; task?: RoomTask; artifact?: RoomArtifact };
        if (data.type === "snapshot") {
          if (data.room) updateRoom(data.room);
          setMessages(data.messages ?? []);
          setTasks(data.tasks ?? []);
          setArtifacts(data.artifacts ?? []);
        } else if (data.type === "room" && data.room) {
          updateRoom(data.room);
        } else if (data.type === "message" && data.message) {
          setMessages((current) => current.some((item) => item.id === data.message?.id) ? current : [...current, data.message!].slice(-500));
        } else if (data.type === "task" && data.task) {
          setTasks((current) => [...current.filter((item) => item.id !== data.task?.id), data.task!].sort((left, right) => right.priority - left.priority || left.createdAt - right.createdAt));
        } else if (data.type === "artifact" && data.artifact) {
          setArtifacts((current) => current.some((item) => item.id === data.artifact?.id) ? current : [...current, data.artifact!]);
        }
      } catch {
        // Ignore malformed frames and let EventSource continue reconnecting.
      }
    };
    events.onerror = () => setConnectionState("reconnecting");
    return () => events.close();
  }, [initialRoom.id, updateRoom]);

  useEffect(() => {
    const element = messagesRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const syncLayout = () => {
      setDetailsOverlay(media.matches);
      if (media.matches) setDetailsOpen(false);
    };
    syncLayout();
    media.addEventListener("change", syncLayout);
    return () => media.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadRunning = () => void fetch("/api/agent/running", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { runningSessionIds?: string[] } | null) => {
        if (!cancelled) setRunningIds(new Set(data?.runningSessionIds ?? []));
      })
      .catch(() => {});
    loadRunning();
    const timer = window.setInterval(loadRunning, 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const postAction = useCallback(async (body: Record<string, unknown>): Promise<RoomResponse> => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json() as RoomResponse;
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    if (data.room) updateRoom(data.room);
    return data;
  }, [room.id, updateRoom]);

  const sendMessage = async () => {
    const content = draft.trim();
    const sender = room.members.find((member) => member.sessionId === room.coordination.coordinatorSessionId) ?? room.members[0];
    if (!content || !sender || busy) return;
    setBusy(true);
    setError(null);
    setDraft("");
    try {
      const data = await postAction({
        action: "chat",
        sessionId: sender.sessionId,
        sessionName: "你",
        authorKind: "user",
        content,
        targetSessionIds: resolveRoomChatTargets(room, content),
      });
      const skipped = data.dispatch?.skipped ?? [];
      if (skipped.length > 0) setError(skipped.map((item) => `${memberName(room, item.sessionId)}：${item.reason}`).join("；"));
    } catch (reason) {
      setDraft(content);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const mention = (name: string) => {
    setDraft((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${name} `);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const createTask = async () => {
    if (!taskTitle.trim() || !taskDescription.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sender = room.coordination.coordinatorSessionId ?? room.members[0]?.sessionId;
      if (!sender) throw new Error("房间没有可用成员。");
      await postAction({
        action: "create_task",
        sessionId: sender,
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        assignedTo: taskAssignee || undefined,
        dedupeKey: taskTitle.trim().toLocaleLowerCase(),
      });
      setTaskTitle("");
      setTaskDescription("");
      setTaskAssignee("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const configureCoordinator = async () => {
    const sender = room.coordination.coordinatorSessionId ?? room.members[0]?.sessionId;
    if (!sender) return;
    setBusy(true);
    try {
      await postAction({
        action: "configure",
        sessionId: sender,
        mode: room.coordination.mode === "coordinator" ? "manual" : "coordinator",
        maxConcurrency: room.coordination.maxConcurrency,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const dispatchTasks = async () => {
    const sender = room.coordination.coordinatorSessionId ?? room.members[0]?.sessionId;
    if (!sender) return;
    setBusy(true);
    setError(null);
    try {
      const data = await postAction({ action: "dispatch", sessionId: sender });
      const skipped = data.dispatch?.skipped ?? [];
      if (skipped.length > 0) {
        setError(skipped.map((item) => {
          const task = tasks.find((candidate) => candidate.id === item.taskId);
          return `${task ? `任务“${task.title}”` : "任务"}：${item.reason}`;
        }).join("；"));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const memberMap = useMemo(() => new Map(room.members.map((member) => [member.sessionId, member])), [room.members]);

  return (
    <section className={styles.workspace} aria-label={`群聊：${room.name}`}>
      <header className={styles.header}>
        <div className={styles.headerIdentity}>
          <span className={styles.groupAvatar} aria-hidden="true"><AliIcon name="message" size={17} /></span>
          <div>
            <h1>{room.name}</h1>
            <p>{room.members.length} 位成员 · {connectionState === "connected" ? "实时连接" : connectionState === "connecting" ? "正在连接" : "正在重连"}</p>
          </div>
        </div>
        <div className={styles.headerMembers} aria-label="群成员">
          {room.members.slice(0, 5).map((member) => (
            <span key={member.sessionId} className={styles.miniAvatar} title={member.name || member.sessionId}>{initials(member.name)}</span>
          ))}
        </div>
        <button type="button" className={styles.detailsButton} onClick={() => setSettingsOpen(true)} aria-label="协作空间设置">
          <AliIcon name="edit" size={15} />
        </button>
        <button type="button" className={`${styles.detailsButton}${detailsOpen ? ` ${styles.active}` : ""}`} onClick={() => setDetailsOpen((current) => !current)} aria-expanded={detailsOpen} aria-label="群聊详情">
          <AliIcon name="layout" size={16} />
        </button>
      </header>

      <div className={styles.content}>
        <div className={styles.conversation}>
          <div ref={messagesRef} className={styles.messages} aria-live="polite">
            {messages.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.groupAvatar}><AliIcon name="message" size={19} /></span>
                <h2>开始群聊</h2>
                <p>直接发送消息会交给协调者；使用 @成员 或 @所有人 指定响应者。</p>
              </div>
            ) : messages.map((message) => {
              if (message.author.kind === "system") {
                return <div key={message.id} className={styles.systemMessage}>{message.content}</div>;
              }
              const isUser = message.author.kind === "user";
              const author = message.author.name || memberMap.get(message.author.id)?.name || message.author.id;
              return (
                <article key={message.id} className={`${styles.message}${isUser ? ` ${styles.userMessage}` : ""}`}>
                  {!isUser ? <span className={styles.avatar}>{initials(author)}</span> : null}
                  <div className={styles.messageColumn}>
                    <div className={styles.messageMeta}>
                      <strong>{author}</strong>
                      <time dateTime={new Date(message.createdAt).toISOString()}>{formatTime(message.createdAt)}</time>
                    </div>
                    <div className={styles.bubble}>
                      <MarkdownBody cwd={room.projectRoot}>{message.content}</MarkdownBody>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className={styles.composerWrap}>
            <div className={styles.mentions}>
              <button type="button" onClick={() => mention("所有人")}>@所有人</button>
              {room.members.map((member) => <button key={member.sessionId} type="button" onClick={() => mention(member.name || member.sessionId.slice(0, 8))}>@{member.name || member.sessionId.slice(0, 8)}</button>)}
            </div>
            {error ? <div className={styles.error} role="alert">{error}</div> : null}
            <div className={styles.composer}>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder="发消息，输入 @ 提及群成员"
                aria-label="群聊消息"
                rows={2}
                maxLength={20_000}
              />
              <button type="button" className={styles.sendButton} disabled={busy || !draft.trim()} onClick={() => { void sendMessage(); }} aria-label="发送群聊消息">
                <AliIcon name="send" size={16} />
              </button>
            </div>
            <div className={styles.composerHint}>Enter 发送 · Shift+Enter 换行 · 未提及成员时由协调者响应</div>
          </div>
        </div>

        {detailsOpen ? (
          <>
          {detailsOverlay ? <button type="button" className={styles.detailsBackdrop} aria-label="关闭群聊详情" onClick={() => setDetailsOpen(false)} /> : null}
          <aside className={styles.details} aria-label="群聊详情">
            <section className={styles.detailSection}>
              <div className={styles.detailHeading}><h2>成员</h2><span>{room.members.length}</span></div>
              <div className={styles.memberList}>
                {room.members.map((member) => (
                  <div key={member.sessionId} className={styles.detailMember}>
                    <span className={styles.avatar}>{initials(member.name)}</span>
                    <div><strong>{member.name || member.sessionId.slice(0, 8)}</strong><small>{roleLabel(member.role)} · {member.sessionId.slice(0, 8)}</small></div>
                    <span className={`${styles.statusDot}${runningIds.has(member.sessionId) ? ` ${styles.running}` : ""}`} title={runningIds.has(member.sessionId) ? "运行中" : "空闲"} />
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.detailSection}>
              <div className={styles.detailHeading}><h2>{room.workspace.label}</h2><span>{room.workspace.mode === "managed" ? "托管" : "自定义"}</span></div>
              <button type="button" className={styles.pathButton} title={room.workspace.path} onClick={() => { void navigator.clipboard.writeText(room.workspace.path); }}>
                <AliIcon name="folder-open" size={14} /><span>{room.workspace.path}</span><AliIcon name="copy" size={13} />
              </button>
              <p className={styles.detailHint}>{room.workspace.instructions || "Agent 在此交换文件；每位成员另有稳定的 private 目录。"}</p>
            </section>

            <section className={styles.detailSection}>
              <div className={styles.detailHeading}><h2>协调与任务</h2><span>{tasks.length}</span></div>
              <div className={styles.coordinationRow}>
                <span>{room.coordination.mode === "coordinator" ? "协调者模式" : "手动模式"}</span>
                <button type="button" disabled={busy} onClick={() => { void configureCoordinator(); }}>{room.coordination.mode === "coordinator" ? "停用" : "启用"}</button>
              </div>
              <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="任务标题" aria-label="任务标题" />
              <textarea value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} placeholder="验收标准与上下文" aria-label="验收标准与上下文" rows={2} />
              <div className={styles.taskActions}>
                <select value={taskAssignee} onChange={(event) => setTaskAssignee(event.target.value)} aria-label="任务执行者">
                  <option value="">自动分配</option>
                  {room.members.map((member) => <option key={member.sessionId} value={member.sessionId}>{member.name || member.sessionId.slice(0, 8)}</option>)}
                </select>
                <button type="button" disabled={busy || !taskTitle.trim() || !taskDescription.trim()} onClick={() => { void createTask(); }}>添加</button>
              </div>
              {room.coordination.mode === "coordinator" ? <button type="button" className={styles.dispatchButton} disabled={busy || !tasks.some((task) => task.status === "pending")} onClick={() => { void dispatchTasks(); }}>分派待办任务</button> : null}
              <div className={styles.taskList}>
                {tasks.slice().reverse().slice(0, 8).map((task) => (
                  <div key={task.id} className={styles.taskCard}>
                    <span data-status={task.status}>{task.status}</span>
                    <strong>{task.title}</strong>
                    <small>{memberName(room, task.assignedTo)}</small>
                  </div>
                ))}
              </div>
            </section>

            {artifacts.length > 0 ? (
              <section className={styles.detailSection}>
                <div className={styles.detailHeading}><h2>公共产物</h2><span>{artifacts.length}</span></div>
                <div className={styles.artifactList}>
                  {artifacts.slice().reverse().slice(0, 8).map((artifact) => (
                    <div key={artifact.id}><AliIcon name="file" size={13} /><span><strong>{artifact.name}</strong><small>{artifact.kind} · {memberName(room, artifact.sessionId)}</small></span></div>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
          </>
        ) : null}
      </div>
      {settingsOpen ? <RoomSettingsDialog room={room} onClose={() => setSettingsOpen(false)} onRoomChange={updateRoom} /> : null}
    </section>
  );
}
