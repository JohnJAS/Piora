import { teamApiError } from "@/lib/team-api";
import { readRoomMessageFullContent } from "@/lib/room-store";
import { requireRoomMemberBySession } from "@/lib/team-agent-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  try {
    const { id, messageId } = await params;
    requireRoomMemberBySession(id, new URL(request.url).searchParams.get("sessionId"));
    return Response.json({ content: readRoomMessageFullContent(id, messageId) });
  } catch (error) { return teamApiError(error); }
}
