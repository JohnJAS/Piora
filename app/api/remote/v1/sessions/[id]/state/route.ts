import { requireRemotePrincipal } from "@/lib/remote-control-auth";
import { remoteErrorResponse } from "@/lib/remote-control-response";
import { getSessionMessageRouter } from "@/lib/session-message-router";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    requireRemotePrincipal(request, "session.state.read", id);
    return Response.json(await getSessionMessageRouter().getState(id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
