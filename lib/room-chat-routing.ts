import { getRoomMemberName, getRoomMemberSessionId, type CollaborationRoom } from "./room-types";

export function resolveRoomChatTargets(room: CollaborationRoom, content: string): string[] {
  if (/(^|\s)@(所有人|all)(?=\s|$|[，,。.!！?？])/iu.test(content)) {
    return room.members.map(getRoomMemberSessionId);
  }
  const lowered = content.toLocaleLowerCase();
  const mentioned = room.members.filter((member) => {
    const name = getRoomMemberName(member).trim();
    return Boolean(name && lowered.includes(`@${name.toLocaleLowerCase()}`));
  });
  if (mentioned.length > 0) return mentioned.map(getRoomMemberSessionId);
  const coordinator = room.members.find((member) => member.memberId === room.coordination.coordinatorMemberId);
  return [coordinator ? getRoomMemberSessionId(coordinator) : room.members[0] ? getRoomMemberSessionId(room.members[0]) : undefined]
    .filter((value): value is string => Boolean(value));
}
