import { listAllSessions } from "@/lib/session-reader";
import { requireRemotePrincipal } from "@/lib/remote-control-auth";
import { remoteErrorResponse } from "@/lib/remote-control-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = requireRemotePrincipal(request, "session.state.read");
    const allowed = principal.allowedSessionIds;
    const sessions = (await listAllSessions())
      .filter((session) => allowed.has(session.id))
      .map((session) => ({ id: session.id, name: session.name, cwd: session.cwd, modified: session.modified, messageCount: session.messageCount }));
    return Response.json({ sessions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
