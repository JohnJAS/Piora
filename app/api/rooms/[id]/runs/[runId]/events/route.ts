import { teamApiError } from "@/lib/team-api";
import { getTeamRunStore } from "@/lib/team-run-store";
import { requireRoomMemberBySession } from "@/lib/team-agent-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    const { id, runId } = await params;
    requireRoomMemberBySession(id, new URL(request.url).searchParams.get("sessionId"));
    const store = getTeamRunStore();
    const after = Math.max(0, Number(new URL(request.url).searchParams.get("after") ?? request.headers.get("last-event-id") ?? 0) || 0);
    store.getTeamRun(id, runId);
    let cleanupStream = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        let cleaned = false;
        let initializing = true;
        let lastCursor = after;
        const pending: ReturnType<typeof store.listTeamRunEvents> = [];
        const send = (event: string, data: unknown, cursor?: number) => {
          if (closed) return;
          const idLine = cursor ? `id: ${cursor}\n` : "";
          try { controller.enqueue(encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { cleanupStream(); }
        };
        const unsubscribe = store.subscribeTeamRunEvents(id, (event) => {
          if (event.teamRunId !== runId) return;
          if (initializing) pending.push(event);
          else if (event.cursor > lastCursor) {
            send("team.event", event, event.cursor);
            lastCursor = event.cursor;
          }
        });
        const heartbeat = setInterval(() => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { cleanupStream(); }
        }, 30_000);
        cleanupStream = () => {
          if (cleaned) return;
          cleaned = true;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        };
        const snapshot = store.getTeamRun(id, runId);
        if (after === 0) {
          send("snapshot", { run: snapshot, cursor: snapshot.revision });
          lastCursor = snapshot.revision;
        } else {
          for (const event of store.listTeamRunEvents(id, runId, after)) {
            if (event.cursor <= lastCursor) continue;
            send("team.event", event, event.cursor);
            lastCursor = event.cursor;
          }
        }
        initializing = false;
        for (const event of pending.sort((left, right) => left.cursor - right.cursor)) {
          if (event.cursor <= lastCursor) continue;
          send("team.event", event, event.cursor);
          lastCursor = event.cursor;
        }
        request.signal.addEventListener("abort", cleanupStream, { once: true });
      },
      cancel() { cleanupStream(); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" } });
  } catch (error) { return teamApiError(error); }
}
