import { requireRemotePrincipal } from "@/lib/remote-control-auth";
import { idempotencyKey, readRemoteJson } from "@/lib/remote-control-request";
import { remoteErrorResponse } from "@/lib/remote-control-response";
import { getSessionMessageRouter } from "@/lib/session-message-router";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const principal = requireRemotePrincipal(request, "session.message.send", id);
    const key = idempotencyKey(request);
    const body = await readRemoteJson(request);
    if (body.targetSessionId !== undefined) {
      // The path is the only target authority. Ignore a legacy body field only
      // when it agrees; a mismatch is rejected instead of silently rerouting.
      if (body.targetSessionId !== id) throw new Error("targetSessionId must match the URL.");
    }
    if (body.delivery !== undefined && body.delivery !== "next_turn") throw new Error("Remote messages use next_turn; use the steer endpoint for steering.");
    if (typeof body.content !== "string") throw new Error("content is required.");
    const expiresIn = body.expiresInSeconds === undefined ? 3_600 : Number(body.expiresInSeconds);
    if (!Number.isFinite(expiresIn) || expiresIn < 1 || expiresIn > 86_400) throw new Error("expiresInSeconds must be between 1 and 86400.");
    const receipt = await getSessionMessageRouter().dispatchSessionMessage({
      targetSessionId: id,
      content: body.content,
      delivery: "next_turn",
      source: "remote",
      idempotencyKey: key,
      expiresAt: Date.now() + Math.floor(expiresIn * 1_000),
      ...(Array.isArray(body.images) ? { images: body.images } : {}),
    }, principal);
    return Response.json({ commandId: receipt.commandId, sessionId: id, status: receipt.status, queuePosition: receipt.queuePosition }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
