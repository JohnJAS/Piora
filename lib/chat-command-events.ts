import { getSessionMessageRouter } from "./session-message-router";
import type { SessionCommandEvent, SessionCommandRecord } from "./session-message-types";
import { enqueueStreamFrame, eventStreamQueue } from "./bounded-event-stream";

export function commandOperationView(record: SessionCommandRecord) {
  return { commandId: record.commandId, idempotencyKey: record.idempotencyKey, targetSessionId: record.targetSessionId, status: record.status, revision: record.revision, queuePaused: record.queuePaused ?? false,
    acceptedAt: record.acceptedAt, taskTiming: record.taskTiming, operation: record.operation, errorCode: record.errorCode, errorMessage: record.errorMessage,
    preview: record.content.slice(0, 180), attachments: (record.images?.length ?? 0) + (record.materials?.length ?? 0) + (record.localFiles?.length ?? 0) };
}

export function createChatCommandEventResponse(request: Request, sessionId: string): Response {
  const router = getSessionMessageRouter();
  let cleanup = () => {};
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let initializing = true;
      const buffered: SessionCommandEvent[] = [];
      const send = (value: unknown, cursor?: number) => {
        if (closed) return;
        try {
          if (!enqueueStreamFrame(controller, encoder.encode(`${cursor === undefined ? "" : `id: ${cursor}\n`}data: ${JSON.stringify(value)}\n\n`))) cleanup();
        }
        catch { cleanup(); }
      };
      const unsubscribe = router.subscribeEvents(sessionId, event => {
        if (initializing) {
          if (buffered.length >= 256) cleanup();
          else buffered.push(event);
        }
        else if (event.source === "ui" || event.operation) send(event, event.cursor);
      });
      const heartbeat = setInterval(() => { if (!closed) { try { if (!enqueueStreamFrame(controller, encoder.encode(":\n\n"))) cleanup(); } catch { cleanup(); } } }, 30_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      if (request.signal.aborted) { cleanup(); return; }
      try {
        const cursor = router.lastEventCursor(sessionId);
        const { commands, hasMore } = await router.operationWindow(sessionId);
        if (closed) return;
        send({ type: "command_snapshot", operations: commands.map(commandOperationView), hasMore, cursor }, cursor);
        initializing = false;
        for (const event of buffered) if (event.cursor > cursor && (event.source === "ui" || event.operation)) send(event, event.cursor);
        if (commands.some(command => command.status === "accepted" || command.status === "queued")) void router.resumeSession(sessionId);
      } catch {
        send({ type: "command_stream_error", message: "Command state is unavailable" });
        cleanup();
      }
    },
    cancel() { cleanup(); },
  }, eventStreamQueue);
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
