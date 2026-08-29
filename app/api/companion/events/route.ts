import { readCompanionRuntimeState, subscribeCompanionRuntime } from "@/lib/companion-runtime";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return new Response("Untrusted API request", { status: 403 });
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    unsubscribe();
  };
  const stream = new ReadableStream({
    start(controller) {
      const send = (state: ReturnType<typeof readCompanionRuntimeState>, reason: string) => {
        controller.enqueue(encoder.encode(`event: companion\ndata: ${JSON.stringify({ reason, state })}\n\n`));
      };
      send(readCompanionRuntimeState(), "connected");
      unsubscribe = subscribeCompanionRuntime(send);
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), 20_000);
      request.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      }, { once: true });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
