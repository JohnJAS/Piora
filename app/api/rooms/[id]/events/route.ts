import { getRoom, listRoomArtifacts, listRoomAudit, listRoomMessages, listRoomTasks, subscribeRoomEvents } from "@/lib/room-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const room = getRoom(id);
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        const send = (data: unknown) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { closed = true; }
        };
        const unsubscribe = subscribeRoomEvents(id, (event) => send(event));
        send({ type: "snapshot", room, messages: listRoomMessages(id), tasks: listRoomTasks(id), artifacts: listRoomArtifacts(id), audit: listRoomAudit(id) });
        const heartbeat = setInterval(() => {
          if (!closed) {
            try { controller.enqueue(encoder.encode(":\n\n")); } catch { closed = true; }
          }
        }, 30_000);
        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        };
        request.signal.addEventListener("abort", cleanup, { once: true });
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 404 });
  }
}
