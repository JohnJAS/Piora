import { requireRemotePrincipal } from "@/lib/remote-control-auth";
import { remoteErrorResponse } from "@/lib/remote-control-response";
import { getSessionMessageRouter } from "@/lib/session-message-router";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: commandId } = await params;
  try {
    const command = await getSessionMessageRouter().getCommand(commandId);
    requireRemotePrincipal(request, "session.messages.read", command.targetSessionId);
    return Response.json({
      commandId: command.commandId,
      sessionId: command.targetSessionId,
      status: command.status,
      acceptedAt: command.acceptedAt,
      queuedAt: command.queuedAt,
      expiresAt: command.expiresAt,
      runId: command.runId,
      attachedRunId: command.attachedRunId,
      errorCode: command.errorCode,
      errorMessage: command.errorMessage,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
