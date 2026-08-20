import { requireRemotePrincipal } from "@/lib/remote-control-auth";
import { idempotencyKey, readRemoteJson } from "@/lib/remote-control-request";
import { remoteErrorResponse } from "@/lib/remote-control-response";
import { getSessionMessageRouter } from "@/lib/session-message-router";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const principal = requireRemotePrincipal(request, "session.steer", id);
    const body = await readRemoteJson(request);
    if (typeof body.content !== "string") throw new Error("content is required.");
    const receipt = await getSessionMessageRouter().steerSession({ targetSessionId: id, content: body.content, source: "remote", idempotencyKey: idempotencyKey(request), ...(Array.isArray(body.images) ? { images: body.images } : {}) }, principal);
    return Response.json({ commandId: receipt.commandId, sessionId: id, status: receipt.status, attachedRunId: receipt.attachedRunId }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
