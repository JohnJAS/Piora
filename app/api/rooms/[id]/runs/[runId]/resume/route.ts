import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { teamApiError } from "@/lib/team-api";
import { getTeamCoordinatorService } from "@/lib/team-coordinator-service";
import { requireRoomCoordinatorBySession } from "@/lib/team-agent-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    const { id, runId } = await params;
    const body = await parseJsonWithinLimit(request, 64 * 1024) as { guidance?: unknown; sessionId?: unknown };
    requireRoomCoordinatorBySession(id, body.sessionId);
    const run = await getTeamCoordinatorService().resumeRun(id, runId, typeof body.guidance === "string" ? body.guidance : undefined);
    return Response.json({ run });
  } catch (error) { return teamApiError(error); }
}
