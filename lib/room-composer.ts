import type { RoomMention } from "./room-types";

/** Preserve selected identities when editing before or after an @token. */
export function adjustRoomMentions(previous: string, next: string, mentions: RoomMention[]): RoomMention[] {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
  const end = previous.length - suffix;
  const delta = next.length - previous.length;
  return mentions.flatMap((mention) => mention.end <= prefix ? [mention]
    : mention.start >= end ? [{ ...mention, start: mention.start + delta, end: mention.end + delta }] : []);
}
