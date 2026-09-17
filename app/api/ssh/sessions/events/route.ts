import { isApiRequestAllowed } from "@/lib/request-security";
import { listSSHSessionsForOwner, subscribeSSHRegistry } from "@/lib/ssh/session-manager";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return new Response("Untrusted API request", { status: 403 });
  const scope = new URL(request.url).searchParams.get("scope");
  if (!scope) return new Response("Scope is required", { status: 400 });
  const owner = scope === "manual" ? undefined : scope, encoder = new TextEncoder();
  let stop: (() => void) | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = () => { const sessions = listSSHSessionsForOwner(owner).map(({ output: _output, ...snapshot }) => { void _output; return snapshot; }); controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "sessions", sessions })}\n\n`)); };
      stop = subscribeSSHRegistry(changed => { if (changed === owner) push(); }); push();
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(": heartbeat\n\n")), 15_000);
      request.signal.addEventListener("abort", () => { stop?.(); if (heartbeat) clearInterval(heartbeat); try { controller.close(); } catch { /* already closed */ } }, { once: true });
    },
    cancel() { stop?.(); if (heartbeat) clearInterval(heartbeat); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" } });
}
