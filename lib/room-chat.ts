import { getRpcSession } from "./rpc-manager";
import { appendRoomMessage, emitRoomPresence, getRoom, listRoomMessages } from "./room-store";
import {
  getSessionMessageRouter,
  type SessionMessageRouter,
  type SessionMessageRouterError,
} from "./session-message-router";
import type { SessionCommandEvent, SessionCommandStatus } from "./session-message-types";
import type { CollaborationRoom, RoomMember } from "./room-types";

export interface RoomChatDispatchResult {
  dispatched: Array<{ sessionId: string; behavior: "prompt" | "next_turn"; commandId: string; status: string }>;
  skipped: Array<{ sessionId: string; reason: string; code?: string }>;
}

function groupChatPrompt(room: CollaborationRoom, member: RoomMember, input: { messageId: string; content: string; replyTo?: string; correlationId?: string; forwardDepth?: number; autoRound?: number; maxAutoRounds?: number }): string {
  return [
    "[PIORA GROUP CHAT]",
    `Room: ${room.name} (${room.id})`,
    `Message ID: ${input.messageId}`,
    `Correlation ID: ${input.correlationId || input.messageId}`,
    `Reply to: ${input.replyTo || "(root message)"}`,
    `Automatic response round: ${input.autoRound ?? 0}/${input.maxAutoRounds ?? 1}`,
    `Your team identity: ${member.name || member.sessionId} (${member.role})`,
    `Your responsibility: ${member.instructions || "Collaborate according to your assigned role."}`,
    `Shared workspace: ${room.workspace.path}`,
    `Workspace contract: ${room.workspace.instructions || "Publish reusable work and avoid overwriting another Agent's active changes."}`,
    `User message: ${input.content}`,
    "You were addressed in a Piora group conversation.",
    "Respond to the group, not only to your private session: use the piora_room tool with action send_shared, this exact room ID, and replyTo set to the Message ID above.",
    "Keep the shared reply concise, include replyTo/correlation context when replying, and do not repeat a reply for the same message ID.",
    "Do not automatically rebroadcast another Agent's shared reply; only respond when explicitly mentioned or routed by the Coordinator.",
  ].join("\n");
}

function isTerminalStatus(status: SessionCommandStatus): boolean {
  return ["completed", "failed", "cancelled", "expired", "interrupted"].includes(status);
}

function relayRoomReply(
  router: SessionMessageRouter,
  room: CollaborationRoom,
  member: RoomMember,
  messageId: string,
  commandId: string,
  initialStatus: SessionCommandStatus,
): void {
  const startedAt = Date.now();
  let settled = false;
  let unsubscribe = () => {};

  const finish = (status: "completed" | "error", detail?: string) => {
    if (settled) return;
    settled = true;
    unsubscribe();
    if (status === "completed") {
      const alreadyShared = listRoomMessages(room.id).some((message) => (
        message.author.id === member.sessionId
        && (message.replyTo === messageId || message.createdAt >= startedAt)
      ));
      if (!alreadyShared) {
        const content = getRpcSession(member.sessionId)?.inner.getLastAssistantText()?.trim();
        if (content) {
          appendRoomMessage(room.id, {
            authorKind: "session",
            authorId: member.sessionId,
            authorName: member.name,
            content,
            replyTo: messageId,
          });
        }
      }
    }
    emitRoomPresence(room.id, { sessionId: member.sessionId, messageId, status, detail });
  };

  const handleEvent = (event: SessionCommandEvent) => {
    if (event.commandId !== commandId) return;
    if (event.type === "command_completed") finish("completed");
    else if (["command_failed", "command_cancelled", "command_expired", "command_interrupted"].includes(event.type)) {
      finish("error", event.errorMessage || "Agent 处理失败");
    }
  };

  unsubscribe = router.subscribeEvents(member.sessionId, handleEvent);
  if (initialStatus === "completed") finish("completed");
  else if (isTerminalStatus(initialStatus)) finish("error", "Agent 处理失败");
  else {
    void router.getCommand(commandId).then((command) => {
      if (command.status === "completed") finish("completed");
      else if (isTerminalStatus(command.status)) finish("error", command.errorMessage || "Agent 处理失败");
    }).catch(() => {
      // The event subscription remains authoritative if the status snapshot races persistence.
    });
  }
}

export async function dispatchRoomChat(
  roomId: string,
  input: { messageId: string; content: string; targetSessionIds?: string[]; attempt?: number; replyTo?: string; correlationId?: string; forwardDepth?: number; autoRound?: number; maxAutoRounds?: number },
): Promise<RoomChatDispatchResult> {
  const room = getRoom(roomId);
  const requested = new Set(input.targetSessionIds?.filter(Boolean));
  const fallbackId = room.coordination.coordinatorSessionId ?? room.members[0]?.sessionId;
  if (requested.size === 0 && fallbackId) requested.add(fallbackId);

  const result: RoomChatDispatchResult = { dispatched: [], skipped: [] };
  const forwardDepth = Math.max(0, Math.floor(input.forwardDepth ?? 0));
  const autoRound = Math.max(0, Math.floor(input.autoRound ?? 0));
  const maxAutoRounds = Math.max(0, Math.min(8, Math.floor(input.maxAutoRounds ?? 1)));
  if (forwardDepth > 4 || autoRound > maxAutoRounds) {
    result.skipped.push({ sessionId: "*", reason: "Room automatic routing limit reached.", code: "ROOM_ROUTING_LIMIT" });
    return result;
  }
  const router = getSessionMessageRouter();
  const targets = [...requested].flatMap((sessionId) => {
    const member = room.members.find((item) => item.sessionId === sessionId);
    return member ? [{ sessionId, member }] : (result.skipped.push({ sessionId, reason: "Session is not a room member." }), []);
  });
  const maxConcurrency = Math.max(1, Math.min(16, room.coordination.maxConcurrency));
  // The legacy `{ type: behavior }` command shape is normalized by the Router;
  // new Room deliveries are always queued as next_turn commands.
  const behavior = "next_turn" as const;
  for (let index = 0; index < targets.length; index += maxConcurrency) {
    const batch = targets.slice(index, index + maxConcurrency);
    batch.forEach(({ sessionId }) => {
      emitRoomPresence(room.id, { sessionId, messageId: input.messageId, status: "processing" });
    });
    const settled = await Promise.allSettled(batch.map(({ sessionId, member }) => router.dispatchSessionMessage({
      targetSessionId: sessionId,
      content: groupChatPrompt(room, member, input),
      delivery: behavior,
      source: "room",
      idempotencyKey: `${roomId}:${input.messageId}:${sessionId}:${input.attempt ?? 1}`,
    })));
    settled.forEach((outcome, batchIndex) => {
      const target = batch[batchIndex];
      if (outcome.status === "fulfilled") {
        result.dispatched.push({ sessionId: target.sessionId, behavior, commandId: outcome.value.commandId, status: outcome.value.status });
        relayRoomReply(router, room, target.member, input.messageId, outcome.value.commandId, outcome.value.status);
      } else {
        const error = outcome.reason as SessionMessageRouterError;
        const reason = error instanceof Error ? error.message : String(error);
        emitRoomPresence(room.id, { sessionId: target.sessionId, messageId: input.messageId, status: "error", detail: reason });
        result.skipped.push({ sessionId: target.sessionId, reason, ...(error?.code ? { code: error.code } : {}) });
      }
    });
  }
  return result;
}
