import { teamApiError } from "@/lib/team-api";
import { getTeamCoordinatorService } from "@/lib/team-coordinator-service";
import { requireRoomCoordinatorBySession } from "@/lib/team-agent-api";
import { parseJsonWithinLimit } from "@/lib/bounded-json";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    const { id, runId } = await params;
    const body = await parseJsonWithinLimit(request, 32 * 1024) as { sessionId?: unknown };
    requireRoomCoordinatorBySession(id, body.sessionId);
    return Response.json({ run: await getTeamCoordinatorService().reconcile(id, runId, "manual") });
  } catch (error) { return teamApiError(error); }
}
