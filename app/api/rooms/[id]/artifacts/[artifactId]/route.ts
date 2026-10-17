import { requireRoomMemberBySession } from "@/lib/team-agent-api";
import { teamApiError } from "@/lib/team-api";
import { TeamError } from "@/lib/team-errors";
import { listRoomArtifacts } from "@/lib/room-store";
import { getTeamRunStore } from "@/lib/team-run-store";
import { roomArtifactDownload } from "@/lib/room-downloads";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await params;
    const { room } = requireRoomMemberBySession(id, new URL(request.url).searchParams.get("sessionId"));
    const artifact = listRoomArtifacts(id).find((item) => item.id === artifactId)
      ?? getTeamRunStore().listTeamRuns(id, { limit: 500 }).flatMap((run) => Object.values(run.artifacts)).find((item) => item.id === artifactId);
    if (!artifact) throw new TeamError("TEAM_INVALID_INPUT", "成果不存在。");
    if (artifact.storedPath) return roomArtifactDownload(join(room.paths.shared, "artifacts"), artifact.storedPath, artifact.name);
    // Commit references have no copied file; expose a portable provenance record.
    return new Response(JSON.stringify(artifact, null, 2), { headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${artifact.name}.json`)}`,
    } });
  } catch (error) { return teamApiError(error); }
}
