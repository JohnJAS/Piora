"use client";

import { useRef, useState } from "react";
import type { CollaborationRoom, RoomTask } from "@/lib/room-types";
import { useI18n } from "@/hooks/useI18n";
import styles from "./RoomWorkspace.module.css";

/** Existing manual/coordinator Rooms retain their task controls in the task drawer. */
export function RoomLegacyTasks({ room, tasks, actor, onRefresh }: {
  room: CollaborationRoom; tasks: RoomTask[]; actor: string; onRefresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const idempotencyKey = useRef("");
  const mutate = async (action: "create_task" | "dispatch") => {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      idempotencyKey.current ||= crypto.randomUUID();
      const response = await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionId: actor, title, description, assignedTo: assignedTo || undefined, dedupeKey: idempotencyKey.current }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : result.error?.message ?? `HTTP ${response.status}`);
      if (action === "create_task") { setTitle(""); setDescription(""); idempotencyKey.current = ""; }
      await onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <section className={styles.legacyTasks}>
    <h4>{t("roomUx.legacy")}</h4>
    {tasks.map((task) => <details key={task.id}><summary><strong>{task.title}</strong><small>{t(`roomUx.phase.${task.status}`)}</small></summary><p>{task.description}</p>{task.result || task.error ? <p>{task.result ?? task.error}</p> : null}</details>)}
    {room.coordination.mode !== "team" || tasks.length ? <details><summary>{t("roomUx.manualTask")}</summary><form className={styles.legacyForm} onSubmit={(event) => { event.preventDefault(); void mutate("create_task"); }}>
      <label>{t("roomUx.taskTitle")}<input required value={title} onChange={(event) => { idempotencyKey.current = ""; setTitle(event.target.value); }} /></label>
      <label>{t("roomUx.taskDescription")}<textarea required rows={3} value={description} onChange={(event) => { idempotencyKey.current = ""; setDescription(event.target.value); }} /></label>
      <label>{t("roomUx.members")}<select value={assignedTo} onChange={(event) => { idempotencyKey.current = ""; setAssignedTo(event.target.value); }}><option value="">{t("roomUx.autoAssign")}</option>{room.members.map((member) => <option key={member.memberId} value={member.binding.sessionId}>{member.profile.name}</option>)}</select></label>
      <button type="submit" disabled={busy || !title.trim() || !description.trim()}>{t("roomUx.createTask")}</button>
    </form></details> : null}
    {room.coordination.mode === "team" && tasks.some((task) => ["pending", "blocked"].includes(task.status)) ? <button type="button" disabled={busy} onClick={() => void mutate("dispatch")}>{t("roomUx.dispatchTasks")}</button> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </section>;
}
