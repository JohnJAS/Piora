import { getRoomMemberName, getRoomMemberSessionId, type CollaborationRoom, type RoomMention } from "./room-types";

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const mentionText = (content: string) => content.replace(/```[\s\S]*?```|`[^`\n]*`|^>[^\n]*/gmu, (match) => " ".repeat(match.length));
export const isRoomBroadcast = (content: string): boolean => /(^|\s)@(所有人|all|everyone)(?=\s|$|[，,。.!！?？])/iu.test(mentionText(content));

/** Exact names only; quoted code, emails, prefixes and duplicate names cannot wake an Agent. */
export function resolveRoomMentions(room: CollaborationRoom, content: string, mentions: RoomMention[] = []): string[] {
  const searchable = mentionText(content);
  const selected = mentions.filter((mention) => Number.isInteger(mention.start) && Number.isInteger(mention.end)
    && mention.start >= 0 && mention.end <= content.length && mention.end > mention.start
    && searchable[mention.start] === "@" && room.members.some((member) => member.memberId === mention.memberId));
  const matches = selected.map((mention) => ({ memberId: mention.memberId, index: mention.start }));
  for (const member of room.members) {
    const name = getRoomMemberName(member).trim();
    if (!name || room.members.filter((candidate) => getRoomMemberName(candidate).toLocaleLowerCase() === name.toLocaleLowerCase()).length !== 1) continue;
    const pattern = new RegExp(`(^|[\\s（(，,：:])@${escapePattern(name)}(?=$|[\\s.,!?，。！？、：:;；)）])`, "giu");
    const match = pattern.exec(searchable);
    if (match && !selected.some((mention) => match.index + match[1].length >= mention.start && match.index + match[1].length < mention.end)) {
      matches.push({ memberId: member.memberId, index: match.index + match[1].length });
    }
  }
  return [...new Set(matches.sort((a, b) => a.index - b.index).map((item) => item.memberId))];
}

export function resolveExplicitRoomChatTargets(
  room: CollaborationRoom,
  content: string,
  options: { excludeSessionId?: string } = {},
): string[] {
  if (isRoomBroadcast(content)) {
    return room.members
      .map(getRoomMemberSessionId)
      .filter((sessionId) => sessionId !== options.excludeSessionId);
  }
  return resolveRoomMentions(room, content).flatMap((id) => {
    const member = room.members.find((candidate) => candidate.memberId === id)!;
    const sessionId = getRoomMemberSessionId(member);
    return sessionId !== options.excludeSessionId ? [sessionId] : [];
  });
}

export function resolveRoomChatTargets(room: CollaborationRoom, content: string): string[] {
  const mentioned = resolveExplicitRoomChatTargets(room, content);
  if (isRoomBroadcast(content)) return mentioned;
  const coordinator = room.members.find((member) => member.memberId === room.coordination.coordinatorMemberId);
  if (mentioned.length > 1 && room.coordination.mode === "team" && coordinator) {
    return [getRoomMemberSessionId(coordinator)];
  }
  if (mentioned.length > 0) return mentioned;
  return [coordinator ? getRoomMemberSessionId(coordinator) : room.members[0] ? getRoomMemberSessionId(room.members[0]) : undefined]
    .filter((value): value is string => Boolean(value));
}
