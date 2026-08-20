import { getRoom } from "./room-store";
import { getSessionMessageRouter, type SessionMessageRouterError } from "./session-message-router";
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
    "Respond to the group, not only to your private session: use the piora_room tool with action send_shared and this exact room ID.",
    "Keep the shared reply concise, include replyTo/correlation context when replying, and do not repeat a reply for the same message ID.",
    "Do not automatically rebroadcast another Agent's shared reply; only respond when explicitly mentioned or routed by the Coordinator.",
  ].join("\n");
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
  // The legacy `{ type: behavior }` command shape is normalized by the Router
  // for older Room callers; new deliveries are always next_turn.
  const behavior = "next_turn" as const;
  for (let index = 0; index < targets.length; index += maxConcurrency) {
    const batch = targets.slice(index, index + maxConcurrency);
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
        result.dispatched.push({ sessionId: target.sessionId, behavior: "next_turn", commandId: outcome.value.commandId, status: outcome.value.status });
      } else {
        const error = outcome.reason as SessionMessageRouterError;
        result.skipped.push({ sessionId: target.sessionId, reason: error instanceof Error ? error.message : String(error), ...(error?.code ? { code: error.code } : {}) });
      }
    });
  }
  return result;
}
