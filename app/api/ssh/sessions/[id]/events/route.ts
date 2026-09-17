import { getSSHSession } from "@/lib/ssh/session-manager";
import { isApiRequestAllowed } from "@/lib/request-security";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(_request)) return new Response("Untrusted API request", { status: 403 });
  const session = getSSHSession((await context.params).id);
  if (!session) return new Response("SSH session not found", { status: 404 });
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let done = false;
  const cleanup = () => { done = true; unsubscribe(); clearInterval(heartbeat); _request.signal.removeEventListener("abort", cleanup); };
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) => { if (!done) { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { cleanup(); } } };
      const snapshot = session.snapshot();
      send({ type: "snapshot", snapshot });
      unsubscribe = session.subscribe(send);
      heartbeat = setInterval(() => { if (!done) { try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { cleanup(); } } }, 15_000);
      _request.signal.addEventListener("abort", cleanup, { once: true });
      if (_request.signal.aborted) cleanup();
    },
    cancel: cleanup,
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
