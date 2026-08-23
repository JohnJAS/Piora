import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { teamApiError } from "@/lib/team-api";
import { getTeamCoordinatorService } from "@/lib/team-coordinator-service";
import { TeamError } from "@/lib/team-errors";
import { requireRoomCoordinatorBySession } from "@/lib/team-agent-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    const { id, runId } = await params;
    const body = await parseJsonWithinLimit(request, 64 * 1024) as { reason?: unknown; sessionId?: unknown };
    requireRoomCoordinatorBySession(id, body.sessionId);
    if (typeof body.reason !== "string" || !body.reason.trim()) throw new TeamError("TEAM_INVALID_INPUT", "Cancellation reason is required.");
    return Response.json({ run: await getTeamCoordinatorService().cancelRun(id, runId, body.reason) });
  } catch (error) { return teamApiError(error); }
}
