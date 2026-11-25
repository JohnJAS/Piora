import { createAgentEventTransport } from "@/lib/agent-event-transport";
import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import { resolveOrStartRpcSession } from "@/lib/session-runtime-resolver";
import { attachChatCommandStream, createChatCommandEventResponse } from "@/lib/chat-command-events";
import { enqueueStreamFrame, eventStreamQueue } from "@/lib/bounded-event-stream";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchParams = new URL(req.url).searchParams;
  if (searchParams.get("scope") === "commands") return createChatCommandEventResponse(req, id);
  const includeCommands = searchParams.get("include") === "commands";
  const runtimeProfile = getAgentRuntimeProfile();

  const sessionReady = resolveOrStartRpcSession(id, { runtimeProfile })
      .then(({ session }) => session)
      .catch((error) => {
        console.error(`[pi-web] failed to start agent for events: ${error}`);
        return null;
      });

  let cleanup = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let eventSeq = 0;
      let unsubscribe = () => {};
      let detachCommands = () => {};
      const timers: { heartbeat?: ReturnType<typeof setInterval>; metrics?: ReturnType<typeof setInterval> } = {};
      const encoder = new TextEncoder();
      const sendFrame = (data: unknown) => {
        if (closed) return;
        try {
          if (!enqueueStreamFrame(controller, encoder.encode(`id: ${++eventSeq}\ndata: ${JSON.stringify(data)}\n\n`))) cleanup();
        }
        catch { cleanup(); }
      };
      const transport = createAgentEventTransport(sendFrame, { incremental: searchParams.get("transport") === "delta" });
      cleanup = () => {
        if (closed) return;
        closed = true;
        transport.close();
        if (timers.heartbeat) clearInterval(timers.heartbeat);
        if (timers.metrics) clearInterval(timers.metrics);
        unsubscribe();
        detachCommands();
        req.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* Already cancelled. */ }
      };
      // Bind cancellation before awaiting startup, including already-aborted requests.
      req.signal.addEventListener("abort", cleanup, { once: true });
      if (req.signal.aborted) { cleanup(); return; }
      if (!enqueueStreamFrame(controller, encoder.encode("retry: 500\n\n"))) { cleanup(); return; }
      const resolved = await sessionReady;
      if (closed) return;
      if (!resolved) {
        transport.push({ type: "error", message: "Failed to start agent session" });
        cleanup();
        return;
      }
      const connectState = typeof resolved.getStreamConnectState === "function"
        ? resolved.getStreamConnectState()
        : resolved.getRuntimeState("progress");
      transport.push({ type: "connected", sessionId: id, runtimeProfile, state: connectState });
      unsubscribe = resolved.onEvent((event) => transport.push(event));
      if (closed) { unsubscribe(); return; }
      // Seed content and its server-owned rate immediately on session switch
      // or reconnect, including when the model is currently silent.
      const message = resolved.getStreamingMessage();
      if (message) transport.push({ type: "message_update", message });
      if (includeCommands && !closed) {
        detachCommands = attachChatCommandStream(id, (payload) => {
          sendFrame({ type: "command_stream", payload });
        }, { onFatalError: cleanup });
      }
      if (closed) return;
      timers.metrics = setInterval(() => {
        const streamingMetrics = resolved.getStreamingMetrics();
        if (streamingMetrics) transport.push({ type: "message_metrics", streamingMetrics });
      }, 1_000);
      timers.heartbeat = setInterval(() => {
        if (!closed) {
          try { if (!enqueueStreamFrame(controller, encoder.encode(":\n\n"))) cleanup(); } catch { cleanup(); }
        }
      }, 30_000);
    },
    cancel() { cleanup(); },
  }, eventStreamQueue);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
