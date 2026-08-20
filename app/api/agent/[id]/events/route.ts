import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import { resolveOrStartRpcSession } from "@/lib/session-runtime-resolver";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runtimeProfile = getAgentRuntimeProfile();

  const sessionReady = resolveOrStartRpcSession(id, { runtimeProfile })
      .then(({ session }) => session)
      .catch((error) => {
        console.error(`[pi-web] failed to start agent for events: ${error}`);
        return null;
      });

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
      encode({ type: "connected", sessionId: id, runtimeProfile });

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
