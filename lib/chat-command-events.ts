import { getSessionMessageRouter } from "./session-message-router";
import type { SessionCommandEvent, SessionCommandRecord } from "./session-message-types";
import { enqueueStreamFrame, eventStreamQueue } from "./bounded-event-stream";

export function commandOperationView(record: SessionCommandRecord) {
  return { commandId: record.commandId, idempotencyKey: record.idempotencyKey, targetSessionId: record.targetSessionId, status: record.status, revision: record.revision, queuePaused: record.queuePaused ?? false,
    acceptedAt: record.acceptedAt, taskTiming: record.taskTiming, operation: record.operation, errorCode: record.errorCode, errorMessage: record.errorMessage,
    preview: record.content.slice(0, 180), attachments: (record.images?.length ?? 0) + (record.materials?.length ?? 0) + (record.localFiles?.length ?? 0) };
}

export function attachChatCommandStream(
  sessionId: string,
  send: (value: unknown, cursor?: number) => void,
  options: { onFatalError?: () => void } = {},
): () => void {
  const router = getSessionMessageRouter();
  let detached = false;
  let initializing = true;
  const buffered: SessionCommandEvent[] = [];
  let unsubscribe = () => {};
  const detach = () => {
    if (detached) return;
    detached = true;
    unsubscribe();
  };

  unsubscribe = router.subscribeEvents(sessionId, event => {
    if (detached) return;
    if (initializing) {
      if (buffered.length >= 256) {
        detach();
        options.onFatalError?.();
      } else {
        buffered.push(event);
      }
      return;
    }
    if (event.source === "ui" || event.operation) send(event, event.cursor);
  });

  void (async () => {
    try {
      const cursor = router.lastEventCursor(sessionId);
      const { commands, hasMore } = await router.operationWindow(sessionId);
      if (detached) return;
      send({ type: "command_snapshot", operations: commands.map(commandOperationView), hasMore, cursor }, cursor);
      initializing = false;
      for (const event of buffered) {
        if (detached) return;
        if (event.cursor > cursor && (event.source === "ui" || event.operation)) send(event, event.cursor);
      }
      if (commands.some(command => command.status === "accepted" || command.status === "queued")) void router.resumeSession(sessionId);
    } catch {
      if (detached) return;
      send({ type: "command_stream_error", message: "Command state is unavailable" });
      detach();
      options.onFatalError?.();
    }
  })();

  return detach;
}

export function createChatCommandEventResponse(request: Request, sessionId: string): Response {
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let sentRetry = false;
      const send = (value: unknown, cursor?: number) => {
        if (closed) return;
        const retryLine = sentRetry ? "" : "retry: 500\n";
        sentRetry = true;
        const idLine = cursor === undefined ? "" : `id: ${cursor}\n`;
        try {
          if (!enqueueStreamFrame(controller, encoder.encode(`${retryLine}${idLine}data: ${JSON.stringify(value)}\n\n`))) cleanup();
        }
        catch { cleanup(); }
      };
      const detach = attachChatCommandStream(sessionId, send, { onFatalError: () => cleanup() });
      const heartbeat = setInterval(() => { if (!closed) { try { if (!enqueueStreamFrame(controller, encoder.encode(":\n\n"))) cleanup(); } catch { cleanup(); } } }, 30_000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        detach();
        request.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
      if (request.signal.aborted) { cleanup(); }
    },
    cancel() { cleanup(); },
  }, eventStreamQueue);
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
