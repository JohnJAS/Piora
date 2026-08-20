import { requireRemotePrincipal } from "@/lib/remote-control-auth";
import { remoteErrorResponse } from "@/lib/remote-control-response";
import { getSessionMessageRouter } from "@/lib/session-message-router";
import type { SessionCommandEvent } from "@/lib/session-message-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    requireRemotePrincipal(request, "session.events.read", id);
    const queryCursor = Number(new URL(request.url).searchParams.get("after") ?? "0");
    const headerCursor = Number(request.headers.get("last-event-id") ?? "0");
    const after = Math.max(0, Number.isFinite(queryCursor) ? queryCursor : 0, Number.isFinite(headerCursor) ? headerCursor : 0);
    const router = getSessionMessageRouter();
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        let replaying = true;
        let lastCursor = after;
        const pending: SessionCommandEvent[] = [];
        const heartbeatRef: { current?: ReturnType<typeof setInterval> } = {};
        const write = (event: SessionCommandEvent) => {
          if (closed || event.cursor <= lastCursor) return;
          lastCursor = event.cursor;
          try {
            controller.enqueue(encoder.encode(`id: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`));
          } catch { closed = true; }
        };
        const unsubscribe = router.subscribeEvents(id, (event) => {
          if (replaying) pending.push(event);
          else write(event);
        });
        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (heartbeatRef.current) clearInterval(heartbeatRef.current);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        };
        request.signal.addEventListener("abort", cleanup, { once: true });
        try {
          const state = await router.getState(id);
          if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "snapshot", sessionId: id, state })}\n\n`));
          for (const event of router.listEvents(id, after)) write(event);
          replaying = false;
          for (const event of pending.splice(0)) write(event);
        } catch {
          if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", code: "SESSION_NOT_FOUND" })}\n\n`));
        }
        heartbeatRef.current = setInterval(() => {
          if (!closed) {
            try { controller.enqueue(encoder.encode(":\n\n")); } catch { cleanup(); }
          }
        }, 30_000);
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) {
    return remoteErrorResponse(error);
  }
}
