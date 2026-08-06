import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession, type AgentSessionWrapper } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Resolve the session without blocking the HTTP response: creating an
  // AgentSession for a cold session takes seconds (model runtime + resource
  // loader setup), and doing it synchronously here stalled every other request
  // in flight (including the session-messages GET the UI needs to render the
  // composer) and made the client's EventSource connection time out.
  const session = getRpcSession(id);
  let sessionReady: Promise<AgentSessionWrapper | null>;
  if (session?.isAlive()) {
    sessionReady = Promise.resolve(session);
  } else {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    sessionReady = startRpcSession(id, filePath, cwd)
      .then(({ session: started }) => started)
      .catch((error) => {
        console.error(`[pi-web] failed to start agent for events: ${error}`);
        return null;
      });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      const resolved = await sessionReady;
      if (!resolved) {
        try {
          encode({ type: "error", message: "Failed to start agent session" });
        } catch { /* controller already closed */ }
        controller.close();
        return;
      }

      // Send initial connected event once the session is actually ready
      encode({ type: "connected", sessionId: id });

      const unsubscribe = resolved.onEvent((event) => {
        encode(event);
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Cleanup when client disconnects
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
