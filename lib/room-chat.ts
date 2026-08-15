import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getAgentRuntimeProfile } from "./agent-runtime-profile";
import { resolveSessionAgentRuntimeProfile } from "./agent-profile-store";
import { getRpcSession, startRpcSession } from "./rpc-manager";
import { getRoom } from "./room-store";
import { resolveSessionPath } from "./session-reader";
import type { CollaborationRoom, RoomMember } from "./room-types";

export interface RoomChatDispatchResult {
  dispatched: Array<{ sessionId: string; behavior: "prompt" | "follow_up" }>;
  skipped: Array<{ sessionId: string; reason: string }>;
}

async function getMemberSession(member: RoomMember) {
  const existing = getRpcSession(member.sessionId);
  if (existing?.isAlive()) return existing;

  const filePath = await resolveSessionPath(member.sessionId);
  if (!filePath) throw new Error("Session file was not found.");
  const runtimeProfile = getAgentRuntimeProfile();
  await resolveSessionAgentRuntimeProfile(member.sessionId, runtimeProfile);
  const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? member.cwd ?? process.cwd();
  return (await startRpcSession(member.sessionId, filePath, cwd, { runtimeProfile })).session;
}

function groupChatPrompt(room: CollaborationRoom, member: RoomMember, messageId: string, content: string): string {
  return [
    "[PIORA GROUP CHAT]",
    `Room: ${room.name} (${room.id})`,
    `Message ID: ${messageId}`,
    `Your team identity: ${member.name || member.sessionId} (${member.role})`,
    `Your responsibility: ${member.instructions || "Collaborate according to your assigned role."}`,
    `Shared workspace: ${room.workspace.path}`,
    `Workspace contract: ${room.workspace.instructions || "Publish reusable work and avoid overwriting another Agent's active changes."}`,
    `User message: ${content}`,
    "You were addressed in a Piora group conversation.",
    "Respond to the group, not only to your private session: use the piora_room tool with action send_shared and this exact room ID.",
    "Keep the shared reply concise, mention other members only when coordination is useful, and do not repeat a reply for the same message ID.",
  ].join("\n");
}

export async function dispatchRoomChat(
  roomId: string,
  input: { messageId: string; content: string; targetSessionIds?: string[] },
): Promise<RoomChatDispatchResult> {
  const room = getRoom(roomId);
  const requested = new Set(input.targetSessionIds?.filter(Boolean));
  const fallbackId = room.coordination.coordinatorSessionId ?? room.members[0]?.sessionId;
  if (requested.size === 0 && fallbackId) requested.add(fallbackId);

  const result: RoomChatDispatchResult = { dispatched: [], skipped: [] };
  for (const sessionId of requested) {
    const member = room.members.find((item) => item.sessionId === sessionId);
    if (!member) {
      result.skipped.push({ sessionId, reason: "Session is not a room member." });
      continue;
    }
    try {
      const session = await getMemberSession(member);
      const running = session.isRunning();
      const behavior = running ? "follow_up" : "prompt";
      await session.send({
        type: behavior,
        message: groupChatPrompt(room, member, input.messageId, input.content),
      });
      result.dispatched.push({ sessionId, behavior });
    } catch (error) {
      result.skipped.push({
        sessionId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
