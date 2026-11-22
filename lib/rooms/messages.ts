import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordAnalyticsRoomMessage } from "../analytics-telemetry";
import type { PrivateRoomNote, RoomMessage, RoomMessageAuthorKind } from "../room-types";
import { TEAM_DEFAULTS } from "../team-types";
import {
  cleanText,
  emitRoomEvent,
  getPrivateRoomDirectory,
  getRoom,
  MAX_MESSAGE_BYTES,
  requireMember,
  requireUtf8Text,
  roomListeners,
  roomPaths,
  withRoomLockSync,
  writeRoom,
} from "./storage";

export function listRoomMessages(
  roomId: string,
  options: { afterSeq?: number; beforeSeq?: number; limit?: number } = {},
): RoomMessage[] {
  const path = roomPaths(roomId).messages;
  getRoom(roomId);
  if (!existsSync(path)) return [];
  const afterSeq = Math.max(0, options.afterSeq ?? 0);
  const limit = Math.max(1, Math.min(500, options.limit ?? 200));
  const messages = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const message = JSON.parse(line) as RoomMessage;
        message.payload ??= {
          byteLength: Buffer.byteLength(message.content, "utf8"),
          lineCount: message.content.split(/\r?\n/).length,
          sha256: createHash("sha256").update(message.content, "utf8").digest("hex"),
          truncated: false,
        };
        return [message];
      } catch { return []; }
    })
    .filter((message) => message.roomId === roomId && message.seq > afterSeq && (options.beforeSeq === undefined || message.seq < options.beforeSeq));
  return messages.slice(-limit);
}

export function appendRoomMessage(roomId: string, input: {
  authorKind: RoomMessageAuthorKind;
  authorId: string;
  authorName?: string;
  authorIdentitySource?: "local_account";
  content: string;
  replyTo?: string;
  correlationId?: string;
  clientPromptId?: string;
  promptRunId?: string;
  threadRootId?: string;
  teamRunId?: string;
  taskId?: string;
  kind?: RoomMessage["kind"];
  targetMemberIds?: string[];
  attachments?: RoomMessage["attachments"];
  forwardDepth?: number;
  autoRound?: number;
  maxAutoRounds?: number;
}): RoomMessage {
  const fullContent = requireUtf8Text(input.content, "群聊消息", MAX_MESSAGE_BYTES);
  const correlationId = input.correlationId ? cleanText(input.correlationId, 240) : undefined;
  let message!: RoomMessage;
  let created = false;
  withRoomLockSync(roomId, () => {
    const room = getRoom(roomId);
    if (input.authorKind === "session") requireMember(room, input.authorId);
    const paths = roomPaths(roomId);
    const parent = input.replyTo ? findRoomMessage(roomId, input.replyTo) : undefined;
    if (correlationId && existsSync(paths.messages)) {
      for (const line of readFileSync(paths.messages, "utf8").split(/\r?\n/)) {
        if (!line) continue;
        try {
          const existing = JSON.parse(line) as RoomMessage;
          if (existing.roomId === roomId && existing.correlationId === correlationId) {
            message = existing;
            return;
          }
        } catch { /* Preserve legacy log tolerance. */ }
      }
    }
    const id = randomUUID();
    const byteLength = Buffer.byteLength(fullContent, "utf8");
    const lineCount = fullContent.split(/\r?\n/).length;
    const truncated = byteLength > TEAM_DEFAULTS.messageBlobThresholdBytes;
    const preview = truncated
      ? fullContent.split(/\r?\n/).slice(0, TEAM_DEFAULTS.previewLines).join("\n").slice(0, TEAM_DEFAULTS.collapseAfterChars)
      : fullContent;
    message = {
      id,
      roomId,
      seq: room.nextSeq,
      author: input.authorKind === "session" ? {
        kind: "session",
        id: input.authorId,
        memberId: requireMember(room, input.authorId).memberId,
        name: requireMember(room, input.authorId).name,
        identitySource: "room_member",
      } : {
        kind: input.authorKind,
        id: input.authorId,
        ...(input.authorName ? { name: input.authorName } : {}),
        ...(input.authorIdentitySource
          ? { identitySource: input.authorIdentitySource }
          : input.authorKind === "system"
            ? { identitySource: "system" as const }
            : {}),
      },
      content: preview,
      payload: {
        byteLength,
        lineCount,
        sha256: createHash("sha256").update(fullContent, "utf8").digest("hex"),
        truncated,
        ...(truncated ? { payloadRef: id } : {}),
      },
      createdAt: Date.now(),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(correlationId ? { correlationId } : {}),
      ...(input.clientPromptId ? { clientPromptId: input.clientPromptId } : {}),
      ...(input.promptRunId ? { promptRunId: input.promptRunId } : {}),
      ...((input.threadRootId ?? parent?.threadRootId) ? { threadRootId: input.threadRootId ?? parent?.threadRootId } : {}),
      ...(input.teamRunId ? { teamRunId: input.teamRunId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.targetMemberIds?.length ? { targetMemberIds: input.targetMemberIds } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      // Nine is the exhausted sentinel: clamping at eight would keep the final
      // allowed round dispatchable forever after each subsequent reply.
      ...(input.forwardDepth !== undefined ? { forwardDepth: Math.max(0, Math.min(9, Math.floor(input.forwardDepth))) } : {}),
      ...(input.autoRound !== undefined ? { autoRound: Math.max(0, Math.min(9, Math.floor(input.autoRound))) } : {}),
      ...(input.maxAutoRounds !== undefined ? { maxAutoRounds: Math.max(0, Math.min(8, Math.floor(input.maxAutoRounds))) } : {}),
    };
    mkdirSync(paths.shared, { recursive: true });
    if (truncated) {
      mkdirSync(paths.messageBlobs, { recursive: true, mode: 0o700 });
      writeFileSync(join(paths.messageBlobs, `${id}.txt`), fullContent, { encoding: "utf8", mode: 0o600, flush: true });
    }
    appendFileSync(paths.messages, `${JSON.stringify(message)}\n`, { encoding: "utf8", mode: 0o600, flush: true });
    room.nextSeq += 1;
    room.updatedAt = message.createdAt;
    writeRoom(room);
    created = true;
  });
  try { recordAnalyticsRoomMessage(roomId, message); } catch { /* A metrics failure must not affect the durable room message. */ }
  if (!created) return message;
  for (const listener of roomListeners().get(roomId) ?? []) listener(message);
  emitRoomEvent({ type: "message", roomId, message });
  return message;
}

export function readRoomMessageFullContent(roomId: string, messageOrId: RoomMessage | string): string {
  const message = typeof messageOrId === "string"
    ? findRoomMessage(roomId, messageOrId)
    : messageOrId;
  if (!message || message.roomId !== roomId) throw new Error("未找到群聊消息。");
  if (!message.payload.truncated) return message.content;
  if (message.payload.payloadRef !== message.id) throw new Error("群聊消息内容引用无效。");
  const path = join(roomPaths(roomId).messageBlobs, `${message.id}.txt`);
  if (!existsSync(path)) throw new Error("群聊消息内容缺失。");
  const content = readFileSync(path, "utf8");
  const hash = createHash("sha256").update(content, "utf8").digest("hex");
  if (hash !== message.payload.sha256 || Buffer.byteLength(content, "utf8") !== message.payload.byteLength) {
    throw new Error("群聊消息内容完整性校验失败。");
  }
  return content;
}

export function findRoomMessage(roomId: string, messageId: string): RoomMessage | undefined {
  const path = roomPaths(roomId).messages;
  getRoom(roomId);
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    try {
      const message = JSON.parse(line) as RoomMessage;
      if (message.roomId === roomId && message.id === messageId) return message;
    } catch { /* Preserve the legacy Room log reader's tolerance. */ }
  }
  return undefined;
}

export function findRoomMessageByCorrelationId(roomId: string, correlationId: string): RoomMessage | undefined {
  const path = roomPaths(roomId).messages;
  getRoom(roomId);
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    try {
      const message = JSON.parse(line) as RoomMessage;
      if (message.roomId === roomId && message.correlationId === correlationId) return message;
    } catch { /* Preserve the legacy Room log reader's tolerance. */ }
  }
  return undefined;
}

export function appendPrivateNote(roomId: string, sessionId: string, content: string): PrivateRoomNote {
  const room = getRoom(roomId);
  requireMember(room, sessionId);
  const directory = getPrivateRoomDirectory(roomId, sessionId);
  mkdirSync(directory, { recursive: true });
  const note: PrivateRoomNote = {
    id: randomUUID(),
    roomId,
    sessionId,
    content: cleanText(content, 64 * 1024),
    createdAt: Date.now(),
  };
  appendFileSync(join(directory, "notes.jsonl"), `${JSON.stringify(note)}\n`, "utf8");
  return note;
}

export function listPrivateNotes(roomId: string, sessionId: string, limit = 100): PrivateRoomNote[] {
  const room = getRoom(roomId);
  requireMember(room, sessionId);
  const path = join(getPrivateRoomDirectory(roomId, sessionId), "notes.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as PrivateRoomNote]; } catch { return []; }
  }).slice(-Math.max(1, Math.min(500, limit)));
}
