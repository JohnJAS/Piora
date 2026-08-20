import { requireRemotePrincipal } from "@/lib/remote-control-auth";
import { remoteErrorResponse } from "@/lib/remote-control-response";
import { getSessionMessageRouter } from "@/lib/session-message-router";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const principal = requireRemotePrincipal(request, "session.abort", id);
    const receipt = await getSessionMessageRouter().abortSessionRun({ targetSessionId: id }, principal);
    return Response.json(receipt, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
