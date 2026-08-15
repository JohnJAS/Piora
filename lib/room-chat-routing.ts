import type { CollaborationRoom } from "./room-types";

export function resolveRoomChatTargets(room: CollaborationRoom, content: string): string[] {
  if (/(^|\s)@(所有人|all)(?=\s|$|[，,。.!！?？])/iu.test(content)) {
    return room.members.map((member) => member.sessionId);
  }
  const lowered = content.toLocaleLowerCase();
  const mentioned = room.members.filter((member) => {
    const name = member.name?.trim();
    return Boolean(name && lowered.includes(`@${name.toLocaleLowerCase()}`));
  });
  if (mentioned.length > 0) return mentioned.map((member) => member.sessionId);
  return [room.coordination.coordinatorSessionId ?? room.members[0]?.sessionId].filter((value): value is string => Boolean(value));
}
