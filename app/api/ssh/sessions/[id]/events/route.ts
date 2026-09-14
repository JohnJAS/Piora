import { getSSHSession } from "@/lib/ssh/session-manager";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = getSSHSession((await context.params).id);
  if (!session) return new Response("SSH session not found", { status: 404 });
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      send({ type: "snapshot", snapshot: session.snapshot() });
      unsubscribe = session.subscribe(send);
    },
    cancel() { unsubscribe(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
