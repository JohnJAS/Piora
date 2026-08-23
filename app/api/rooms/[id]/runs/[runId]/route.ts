import { teamApiError } from "@/lib/team-api";
import { deriveRunProjection, deriveTaskProjection } from "@/lib/team-run-reducer";
import { getTeamRunStore } from "@/lib/team-run-store";
import { requireRoomMemberBySession } from "@/lib/team-agent-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    const { id, runId } = await params;
    requireRoomMemberBySession(id, new URL(request.url).searchParams.get("sessionId"));
    const run = getTeamRunStore().getTeamRun(id, runId);
    return Response.json({ run, taskRun: deriveRunProjection(run), taskRuns: Object.keys(run.tasks).map((taskId) => deriveTaskProjection(run, taskId)) });
  } catch (error) { return teamApiError(error); }
}
