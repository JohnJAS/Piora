import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { requireRoomCoordinatorBySession } from "@/lib/team-agent-api";
import { disposeManagedTeamAgentSession } from "@/lib/team-agent-provisioner";
import { teamApiError } from "@/lib/team-api";
import { removeRoomMember, updateRoomAgentProfile } from "@/lib/room-store";
import { TeamError } from "@/lib/team-errors";
import type { TeamAgentProfile } from "@/lib/team-types";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  try {
    const { id, memberId } = await params;
    const body = await parseJsonWithinLimit(request, 256 * 1024) as { sessionId?: unknown; expectedRevision?: unknown; patch?: unknown };
    const { member } = requireRoomCoordinatorBySession(id, body.sessionId);
    if (!Number.isInteger(body.expectedRevision) || !body.patch || typeof body.patch !== "object") {
      throw new TeamError("TEAM_INVALID_INPUT", "expectedRevision and profile patch are required.");
    }
    const room = updateRoomAgentProfile(id, member.binding.sessionId, memberId, body.expectedRevision as number, body.patch as Partial<TeamAgentProfile>);
    return Response.json({ room, agent: room.members.find((candidate) => candidate.memberId === memberId) });
  } catch (error) { return teamApiError(error); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  try {
    const { id, memberId } = await params;
    const body = await parseJsonWithinLimit(request, 32 * 1024) as { sessionId?: unknown; disposeManaged?: unknown };
    const { room, member: requester } = requireRoomCoordinatorBySession(id, body.sessionId);
    const target = room.members.find((candidate) => candidate.memberId === memberId);
    if (!target) throw new TeamError("TEAM_MEMBER_NOT_FOUND", "Team Agent was not found.");
    if (body.disposeManaged === true) await disposeManagedTeamAgentSession(room, memberId);
    const saved = removeRoomMember(id, target.binding.sessionId, requester.binding.sessionId);
    return Response.json({ room: saved });
  } catch (error) { return teamApiError(error); }
}
