"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { CollaborationRoom, RoomAuditEntry, RoomMember, RoomMemberRole } from "@/lib/room-types";
import type { SessionInfo } from "@/lib/types";
import { AliIcon } from "./AliIcon";
import styles from "./RoomSettingsDialog.module.css";

type Section = "overview" | "agents" | "workspace" | "coordination";
type MemberDraft = Pick<RoomMember, "name" | "instructions" | "role" | "sessionId">;

const roleOptions: Array<{ value: RoomMemberRole; label: string; detail: string }> = [
  { value: "coordinator", label: "协调者", detail: "负责拆解、分派和最终决策" },
  { value: "planner", label: "规划者", detail: "负责方案、依赖和风险识别" },
  { value: "worker", label: "执行者", detail: "负责实现和交付任务" },
  { value: "reviewer", label: "审查者", detail: "负责验证、评审和质量门禁" },
  { value: "participant", label: "参与者", detail: "按需参与讨论和协作" },
];

const auditTimeFormatter = new Intl.DateTimeFormat(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

function sessionName(session: SessionInfo): string {
  return session.name?.trim() || session.firstMessage?.trim().slice(0, 64) || session.id.slice(0, 8);
}

function sameProject(room: CollaborationRoom, session: SessionInfo): boolean {
  if (!room.projectRoot) return true;
  return (session.projectRoot ?? session.cwd).toLocaleLowerCase() === room.projectRoot.toLocaleLowerCase();
}

function actorSessionId(room: CollaborationRoom): string | undefined {
  return room.coordination.coordinatorSessionId
    ?? room.members.find((member) => member.role === "coordinator")?.sessionId
    ?? room.members[0]?.sessionId;
}

export function RoomSettingsDialog({
  room,
  onClose,
  onRoomChange,
}: {
  room: CollaborationRoom;
  onClose: () => void;
  onRoomChange: (room: CollaborationRoom) => void;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [audit, setAudit] = useState<RoomAuditEntry[]>([]);
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description ?? "");
  const [workspaceMode, setWorkspaceMode] = useState(room.workspace.mode);
  const [workspacePath, setWorkspacePath] = useState(room.workspace.path);
  const [workspaceLabel, setWorkspaceLabel] = useState(room.workspace.label);
  const [workspaceInstructions, setWorkspaceInstructions] = useState(room.workspace.instructions ?? "");
  const [memberDrafts, setMemberDrafts] = useState<Record<string, MemberDraft>>({});
  const [newSessionId, setNewSessionId] = useState("");
  const [newRole, setNewRole] = useState<RoomMemberRole>("worker");
  const [newName, setNewName] = useState("");
  const [newInstructions, setNewInstructions] = useState("");
  const [coordinationMode, setCoordinationMode] = useState(room.coordination.mode);
  const [coordinatorId, setCoordinatorId] = useState(room.coordination.coordinatorSessionId ?? room.members[0]?.sessionId ?? "");
  const [maxConcurrency, setMaxConcurrency] = useState(room.coordination.maxConcurrency);
  const [leaseMinutes, setLeaseMinutes] = useState(Math.round(room.coordination.leaseDurationMs / 60_000));
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useFocusTrap(dialogRef, true, { onEscape: busy ? undefined : onClose });

  useEffect(() => {
    setName(room.name);
    setDescription(room.description ?? "");
    setWorkspaceMode(room.workspace.mode);
    setWorkspacePath(room.workspace.path);
    setWorkspaceLabel(room.workspace.label);
    setWorkspaceInstructions(room.workspace.instructions ?? "");
    setCoordinationMode(room.coordination.mode);
    setCoordinatorId(room.coordination.coordinatorSessionId ?? room.members[0]?.sessionId ?? "");
    setMaxConcurrency(room.coordination.maxConcurrency);
    setLeaseMinutes(Math.round(room.coordination.leaseDurationMs / 60_000));
    setMemberDrafts(Object.fromEntries(room.members.map((member) => [member.memberId, {
      name: member.name ?? "",
      instructions: member.instructions ?? "",
      role: member.role,
      sessionId: member.sessionId,
    }])));
  }, [room]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/sessions", { cache: "no-store" }).then(async (response) => {
        const data = await response.json() as { sessions?: SessionInfo[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        return data.sessions ?? [];
      }),
      fetch(`/api/rooms/${encodeURIComponent(room.id)}`, { cache: "no-store" }).then(async (response) => {
        const data = await response.json() as { audit?: RoomAuditEntry[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        return data.audit ?? [];
      }),
    ])
      .then(([nextSessions, nextAudit]) => {
        if (cancelled) return;
        setSessions(nextSessions.filter((session) => sameProject(room, session)));
        setAudit(nextAudit);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [room]);

  const availableSessions = useMemo(() => {
    const bound = new Set(room.members.map((member) => member.sessionId));
    return sessions.filter((session) => !bound.has(session.id));
  }, [room.members, sessions]);

  const postAction = async (action: Record<string, unknown>, successMessage: string) => {
    const actor = actorSessionId(room);
    if (!actor) throw new Error("房间没有可用的协调者 Session。");
    setBusy(String(action.action));
    setError(null);
    setSaved(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...action, sessionId: actor }),
      });
      const data = await response.json() as { room?: CollaborationRoom; error?: string };
      if (!response.ok || !data.room) throw new Error(data.error ?? `HTTP ${response.status}`);
      onRoomChange(data.room);
      setSaved(successMessage);
      return data.room;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      setBusy(null);
    }
  };

  const saveOverview = () => void postAction({ action: "update_room", title: name, description }, "群聊资料已保存").catch(() => {});

  const saveWorkspace = () => void postAction({
    action: "update_workspace",
    workspaceMode,
    workspacePath: workspacePath.trim(),
    workspaceLabel,
    instructions: workspaceInstructions,
  }, "共享工作区已更新").catch(() => {});

  const saveMember = (member: RoomMember) => {
    const draft = memberDrafts[member.memberId];
    if (!draft) return;
    const session = sessions.find((candidate) => candidate.id === draft.sessionId);
    void postAction({
      action: "update_member",
      memberId: member.memberId,
      targetSessionId: draft.sessionId,
      sessionName: draft.name,
      instructions: draft.instructions,
      role: draft.role,
      cwd: session?.cwd ?? member.cwd,
      projectRoot: session ? (session.projectRoot ?? session.cwd) : member.projectRoot,
    }, `${draft.name || "Agent"} 已更新`).catch(() => {});
  };

  const addAgent = () => {
    const session = sessions.find((candidate) => candidate.id === newSessionId);
    if (!session) return;
    void postAction({
      action: "add_member",
      targetSessionId: session.id,
      sessionName: newName.trim() || sessionName(session),
      instructions: newInstructions,
      role: newRole,
      cwd: session.cwd,
      projectRoot: session.projectRoot ?? session.cwd,
    }, "Agent 已加入协作空间").then(() => {
      setNewSessionId("");
      setNewName("");
      setNewInstructions("");
    }).catch(() => {});
  };

  const removeAgent = (member: RoomMember) => {
    if (removeConfirmId !== member.memberId) {
      setRemoveConfirmId(member.memberId);
      return;
    }
    void postAction({ action: "leave", targetSessionId: member.sessionId }, `${member.name || "Agent"} 已移出`).then(() => {
      setRemoveConfirmId(null);
    }).catch(() => {});
  };

  const saveCoordination = () => void postAction({
    action: "configure",
    mode: coordinationMode,
    targetSessionId: coordinatorId,
    maxConcurrency,
    leaseDurationMs: leaseMinutes * 60_000,
  }, "编排策略已保存").catch(() => {});

  const updateDraft = (memberId: string, patch: Partial<MemberDraft>) => {
    setMemberDrafts((current) => ({ ...current, [memberId]: { ...current[memberId], ...patch } }));
  };

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="room-settings-title">
        <header className={styles.header}>
          <div><h2 id="room-settings-title">协作空间设置</h2><p>{room.name}</p></div>
          <button type="button" onClick={onClose} aria-label="关闭协作空间设置" disabled={Boolean(busy)}><AliIcon name="close" size={16} /></button>
        </header>
        <div className={styles.body}>
          <nav className={styles.nav} aria-label="协作空间设置分类">
            {([
              ["overview", "概览", "message"],
              ["agents", "Agent", "robot"],
              ["workspace", "工作区", "folder-open"],
              ["coordination", "编排", "branches"],
            ] as const).map(([key, label, icon]) => (
              <button key={key} type="button" className={section === key ? styles.active : ""} onClick={() => { setSection(key); setError(null); setSaved(null); }}>
                <AliIcon name={icon} size={15} /><span>{label}</span>
              </button>
            ))}
          </nav>
          <div className={styles.content}>
            {section === "overview" ? (
              <div className={styles.page}>
                <div className={styles.pageHeading}><h3>概览</h3><p>定义这个多 Agent 团队共同解决什么问题。</p></div>
                <label className={styles.field}><span>群聊名称</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
                <label className={styles.field}><span>团队说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} maxLength={2_000} placeholder="目标、边界和最终交付标准" /></label>
                <div className={styles.metadata}><span>项目</span><code>{room.projectRoot ?? "未绑定项目"}</code><span>Room ID</span><code>{room.id}</code></div>
                <section className={styles.auditList}>
                  <h4>最近变更</h4>
                  {audit.length === 0 ? <p>暂无配置变更。</p> : audit.slice(-6).reverse().map((entry) => (
                    <div key={entry.id}><span>{entry.summary}</span><time dateTime={new Date(entry.createdAt).toISOString()}>{auditTimeFormatter.format(entry.createdAt)}</time></div>
                  ))}
                </section>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={Boolean(busy) || !name.trim()} onClick={saveOverview}>保存概览</button></div>
              </div>
            ) : null}

            {section === "agents" ? (
              <div className={styles.page}>
                <div className={styles.pageHeading}><h3>Agent 团队</h3><p>身份长期存在，Session 可以换绑；职责会进入 Agent 的协作上下文。</p></div>
                <div className={styles.agentList}>
                  {room.members.map((member) => {
                    const draft = memberDrafts[member.memberId];
                    if (!draft) return null;
                    const selected = sessions.find((session) => session.id === draft.sessionId);
                    return (
                      <article key={member.memberId} className={styles.agentCard}>
                        <div className={styles.agentIdentity}><span>{(draft.name || "A").slice(0, 1).toLocaleUpperCase()}</span><div><strong>{draft.name || "未命名 Agent"}</strong><small>{selected?.worktreeBranch ?? selected?.cwd ?? member.cwd ?? draft.sessionId}</small></div></div>
                        <div className={styles.agentGrid}>
                          <label className={styles.field}><span>显示名称</span><input value={draft.name ?? ""} onChange={(event) => updateDraft(member.memberId, { name: event.target.value })} /></label>
                          <label className={styles.field}><span>团队角色</span><select value={draft.role} onChange={(event) => updateDraft(member.memberId, { role: event.target.value as RoomMemberRole })}>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                          <label className={`${styles.field} ${styles.full}`}><span>绑定 Session</span><select value={draft.sessionId} onChange={(event) => updateDraft(member.memberId, { sessionId: event.target.value })}>{sessions.filter((session) => session.id === member.sessionId || !room.members.some((candidate) => candidate.sessionId === session.id)).map((session) => <option key={session.id} value={session.id}>{sessionName(session)} · {session.worktreeBranch ?? session.cwd}</option>)}</select></label>
                          <label className={`${styles.field} ${styles.full}`}><span>职责与约束</span><textarea value={draft.instructions ?? ""} onChange={(event) => updateDraft(member.memberId, { instructions: event.target.value })} rows={3} placeholder="例如：只负责审查，不直接修改代码；重点检查安全和回归。" /></label>
                        </div>
                        <div className={styles.cardActions}><button type="button" disabled={Boolean(busy)} onClick={() => removeAgent(member)}>{removeConfirmId === member.memberId ? "再次点击确认移出" : "移出"}</button><button type="button" className={styles.primary} disabled={Boolean(busy) || !draft.name?.trim()} onClick={() => saveMember(member)}>保存 Agent</button></div>
                      </article>
                    );
                  })}
                </div>
                <section className={styles.addAgent}>
                  <div><h4>添加 Agent</h4><p>只能选择同一项目中尚未加入的 Session。</p></div>
                  <label className={styles.field}><span>Session</span><select value={newSessionId} onChange={(event) => { const id = event.target.value; setNewSessionId(id); const session = sessions.find((candidate) => candidate.id === id); if (session) setNewName(sessionName(session)); }}><option value="">选择 Session</option>{availableSessions.map((session) => <option key={session.id} value={session.id}>{sessionName(session)} · {session.worktreeBranch ?? session.cwd}</option>)}</select></label>
                  <div className={styles.agentGrid}><label className={styles.field}><span>显示名称</span><input value={newName} onChange={(event) => setNewName(event.target.value)} /></label><label className={styles.field}><span>角色</span><select value={newRole} onChange={(event) => setNewRole(event.target.value as RoomMemberRole)}>{roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label></div>
                  <label className={styles.field}><span>职责与约束</span><textarea rows={3} value={newInstructions} onChange={(event) => setNewInstructions(event.target.value)} /></label>
                  <div className={styles.actions}><button type="button" className={styles.primary} disabled={Boolean(busy) || !newSessionId || !newName.trim()} onClick={addAgent}>添加到团队</button></div>
                </section>
              </div>
            ) : null}

            {section === "workspace" ? (
              <div className={styles.page}>
                <div className={styles.pageHeading}><h3>共享工作区</h3><p>Agent 在这里交换文件；消息、任务与审计仍由 Piora 独立托管。</p></div>
                <div className={styles.segmented}><button type="button" className={workspaceMode === "managed" ? styles.selected : ""} onClick={() => setWorkspaceMode("managed")}>Piora 托管</button><button type="button" className={workspaceMode === "custom" ? styles.selected : ""} onClick={() => setWorkspaceMode("custom")}>项目内目录</button></div>
                <label className={styles.field}><span>工作区名称</span><input value={workspaceLabel} onChange={(event) => setWorkspaceLabel(event.target.value)} /></label>
                <label className={styles.field}><span>目录</span><input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} disabled={workspaceMode === "managed"} aria-describedby="workspace-path-help" /><small id="workspace-path-help">自定义目录必须位于 {room.projectRoot ?? "房间项目"} 内；保存时会自动创建。</small></label>
                <label className={styles.field}><span>协作约定</span><textarea rows={6} value={workspaceInstructions} onChange={(event) => setWorkspaceInstructions(event.target.value)} placeholder="文件命名、目录分工、交付方式和禁止覆盖的范围" /></label>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={Boolean(busy) || !workspaceLabel.trim() || (workspaceMode === "custom" && !workspacePath.trim())} onClick={saveWorkspace}>保存工作区</button></div>
              </div>
            ) : null}

            {section === "coordination" ? (
              <div className={styles.page}>
                <div className={styles.pageHeading}><h3>任务编排</h3><p>控制谁负责协调、同时运行多少任务，以及失联任务何时自动释放。</p></div>
                <label className={styles.field}><span>运行模式</span><select value={coordinationMode} onChange={(event) => setCoordinationMode(event.target.value as "manual" | "coordinator")}><option value="manual">手动协作</option><option value="coordinator">协调者编排</option></select></label>
                <label className={styles.field}><span>协调者 Agent</span><select value={coordinatorId} onChange={(event) => setCoordinatorId(event.target.value)}>{room.members.map((member) => <option key={member.memberId} value={member.sessionId}>{member.name || member.sessionId.slice(0, 8)}</option>)}</select></label>
                <div className={styles.agentGrid}><label className={styles.field}><span>最大并发</span><input type="number" min={1} max={16} value={maxConcurrency} onChange={(event) => setMaxConcurrency(Number(event.target.value))} /></label><label className={styles.field}><span>任务租约（分钟）</span><input type="number" min={1} max={60} value={leaseMinutes} onChange={(event) => setLeaseMinutes(Number(event.target.value))} /></label></div>
                <div className={styles.roleGuide}>{roleOptions.map((role) => <div key={role.value}><strong>{role.label}</strong><span>{role.detail}</span></div>)}</div>
                <div className={styles.actions}><button type="button" className={styles.primary} disabled={Boolean(busy) || !coordinatorId} onClick={saveCoordination}>保存编排策略</button></div>
              </div>
            ) : null}
            {error ? <div className={styles.error} role="alert">{error}</div> : null}
            {saved ? <div className={styles.saved} role="status"><AliIcon name="check" size={14} />{saved}</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
