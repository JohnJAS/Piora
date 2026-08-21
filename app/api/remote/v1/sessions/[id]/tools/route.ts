import { requireRemotePrincipal } from "@/lib/remote-control-auth";
import { remoteErrorResponse } from "@/lib/remote-control-response";
import { resolveOrStartRpcSession } from "@/lib/session-runtime-resolver";

export const dynamic = "force-dynamic";

interface RemoteToolInfo {
  name: string;
  description: string;
  active: boolean;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    requireRemotePrincipal(request, "session.tools.read", id);
    const { session } = await resolveOrStartRpcSession(id);
    const [tools, commands] = await Promise.all([
      session.send({ type: "get_tools" }) as Promise<RemoteToolInfo[]>,
      session.send({ type: "get_commands" }),
    ]);
    return Response.json({
      sessionId: id,
      runtimeProfile: session.runtimeProfile,
      tools,
      activeToolNames: tools.filter((tool) => tool.active).map((tool) => tool.name),
      commands,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
