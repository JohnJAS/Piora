import { getSSHSession } from "@/lib/ssh/session-manager";
import { isApiRequestAllowed } from "@/lib/request-security";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(_request)) return new Response("Untrusted API request", { status: 403 });
  const session = getSSHSession((await context.params).id);
  if (!session) return new Response("SSH session not found", { status: 404 });
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const snapshot = session.snapshot();
      send({ type: "snapshot", terminalId: snapshot.id, generation: 0, sequence: 0, snapshot: { session: snapshot, output: "" } });
      unsubscribe = session.subscribe(send);
    },
    cancel() { unsubscribe(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
