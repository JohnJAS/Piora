import { createHash } from "node:crypto";
import { assessRoomMember, type RoomSelfAssessment } from "./room-member-assessment";
import { appendRoomMessage, emitRoomPresence, getRoom } from "./room-store";
import type { CollaborationRoom, RoomMember, RoomMemberAssessment, RoomMemberSelection } from "./room-types";

export interface RoomSelectionServices {
  assess: (room: CollaborationRoom, member: RoomMember, content: string, signal: AbortSignal) => Promise<RoomSelfAssessment>;
  timeoutMs?: number;
}

export const defaultRoomSelectionServices: RoomSelectionServices = { assess: assessRoomMember };

function fingerprint(member: RoomMember): string {
  return createHash("sha256").update(JSON.stringify({ profile: member.profile, binding: member.binding })).digest("hex");
}

/** Called outside the room submission lock; each bounded result is durably saved. */
export async function selectRoomMessageHandler(roomId: string, messageId: string, content: string,
  selection: RoomMemberSelection, save: () => void, services = defaultRoomSelectionServices): Promise<string> {
  let room = getRoom(roomId);
  const valid = (member: RoomMember, result: RoomMemberAssessment) => result.memberId === member.memberId && result.fingerprint === fingerprint(member);
  if (selection.selectedMemberId && room.members.some(member => member.memberId === selection.selectedMemberId
    && selection.assessments.some(result => result.status === "completed" && valid(member, result)))) return selection.selectedMemberId;
  delete selection.selectedMemberId;
  delete selection.clarificationOnly;
  selection.assessments = selection.assessments.filter(result => result.status === "completed" && room.members.some(member => valid(member, result)));
  const pending = room.members.filter(member => !selection.assessments.some(result => valid(member, result)));
  const concurrency = Math.max(1, Math.min(4, room.coordination.maxConcurrency));
  for (let start = 0; start < pending.length; start += concurrency) {
    await Promise.all(pending.slice(start, start + concurrency).map(async member => {
      emitRoomPresence(roomId, { sessionId: member.binding.sessionId, messageId, status: "processing", phase: "selection", detail: "正在判断是否适合接手" });
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          services.assess(room, member, content, controller.signal),
          new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("接手判断超时")); }, services.timeoutMs ?? 45_000); }),
        ]);
        selection.assessments.push({ memberId: member.memberId, fingerprint: fingerprint(member), ...result, status: "completed" });
        emitRoomPresence(roomId, { sessionId: member.binding.sessionId, messageId, status: "completed", detail: result.reason });
      } catch {
        // Provider errors can contain credentials; persist only owned copy.
        selection.assessments.push({ memberId: member.memberId, fingerprint: fingerprint(member), suitable: false, confidence: 0, reason: "接手判断失败或超时，可重试", status: "error" });
        emitRoomPresence(roomId, { sessionId: member.binding.sessionId, messageId, status: "error", detail: "接手判断失败或超时" });
      } finally { if (timer) clearTimeout(timer); }
      save();
    }));
  }
  room = getRoom(roomId);
  if (room.members.some(member => !selection.assessments.some(result => valid(member, result)))) throw new Error("群成员或配置已变化，请重试以完成全部成员判断。");
  const completed = selection.assessments.filter(result => result.status === "completed" && room.members.some(member => valid(member, result)));
  const candidates = completed.filter(result => result.suitable).sort((a, b) => b.confidence - a.confidence
    || Number(b.memberId === room.coordination.coordinatorMemberId) - Number(a.memberId === room.coordination.coordinatorMemberId)
    || a.memberId.localeCompare(b.memberId));
  if (!completed.length) throw new Error("成员均未能完成接手判断，原消息已保留，请检查成员模型配置后重试。");
  const selected = candidates[0] ?? completed.find(result => result.memberId === room.coordination.coordinatorMemberId) ?? completed[0];
  selection.selectedMemberId = selected.memberId;
  selection.clarificationOnly = candidates.length === 0;
  save();
  return selected.memberId;
}

export function publishRoomMemberSelection(roomId: string, messageId: string, selection: RoomMemberSelection): void {
  const room = getRoom(roomId);
  const selected = room.members.find(member => member.memberId === selection.selectedMemberId);
  if (!selected || !selection.assessments.some(result => result.status === "completed" && result.memberId === selected.memberId && result.fingerprint === fingerprint(selected))) throw new Error("选定成员配置已变化，请重试原消息。");
  const name = selected.profile.name;
  appendRoomMessage(roomId, { authorKind: "system", authorId: "piora", authorName: "Piora", replyTo: messageId,
    correlationId: `room-selection:${messageId}:${selected.memberId}`, targetMemberIds: [selected.memberId],
    content: [selection.clarificationOnly ? `成员均未认领，由 ${name} 负责澄清需求。` : `本条消息由 ${name} 处理。`,
      ...room.members.map(member => { const result = selection.assessments.find(item => item.memberId === member.memberId && item.fingerprint === fingerprint(member));
        return `${member.profile.name}：${result?.status === "completed" ? result.suitable ? "适合接手" : "暂不接手" : "判断未完成"}，${result?.reason ?? "成员配置已变化"}`; }),
    ].join("\n") });
}
