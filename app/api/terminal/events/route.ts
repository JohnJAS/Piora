import { validateTerminalCwd, getTerminalSession, TerminalSessionError } from "@/lib/terminal-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(request: Request) {
  try {
    const cwd = await validateTerminalCwd(new URL(request.url).searchParams.get("cwd"));
    const terminal = getTerminalSession(cwd);
    terminal.start();
    let unsubscribe = () => {};
    let heartbeat: NodeJS.Timeout | null = null;
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (value: unknown) => {
          if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        };
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          try { controller.close(); } catch { /* The client may already be gone. */ }
        };
        send({ type: "snapshot", ...terminal.snapshot() });
        unsubscribe = terminal.subscribe(send);
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": keepalive\n\n"));
        }, 15_000);
        heartbeat.unref?.();
        request.signal.addEventListener("abort", close, { once: true });
      },
      cancel() {
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const status = error instanceof TerminalSessionError ? error.status : 500;
    return new Response(error instanceof Error ? error.message : String(error), { status });
  }
}
