import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { requireRoomCoordinatorBySession } from "@/lib/team-agent-api";
import { reconfigureTeamAgentSession } from "@/lib/team-agent-provisioner";
import { teamApiError } from "@/lib/team-api";
import { updateRoomAgentBinding } from "@/lib/room-store";
import { TeamError } from "@/lib/team-errors";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  try {
    const { id, memberId } = await params;
    const body = await parseJsonWithinLimit(request, 32 * 1024) as { sessionId?: unknown; expectedProfileRevision?: unknown };
    const { room, member } = requireRoomCoordinatorBySession(id, body.sessionId);
    if (!Number.isInteger(body.expectedProfileRevision)) throw new TeamError("TEAM_INVALID_INPUT", "expectedProfileRevision is required.");
    const binding = await reconfigureTeamAgentSession(room, memberId, body.expectedProfileRevision as number);
    const saved = updateRoomAgentBinding(id, member.binding.sessionId, memberId, binding);
    return Response.json({ room: saved, agent: saved.members.find((candidate) => candidate.memberId === memberId) });
  } catch (error) { return teamApiError(error); }
}
