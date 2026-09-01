import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { getDesignRunOperationRegistry } from "@/lib/design-to-harmony/run-operations";
import { getDesignAnalysisRunStore } from "@/lib/design-to-harmony/run-store";
import { designErrorResponse, designProjectPathsEqual, validateDesignProjectRoot, validateDesignRunId } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const projectRoot = await validateDesignProjectRoot(new URL(request.url).searchParams.get("projectRoot"));
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    const runStore = getDesignAnalysisRunStore();
    const run = runStore.get(id);
    if (!run || !designProjectPathsEqual(run.projectRoot, projectRoot)) throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design run not found for this project", { status: 404, stage: "store" });
    const registry = getDesignRunOperationRegistry();
    const encoder = new TextEncoder();
    let unsubscribe: () => void = () => undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (event: unknown) => {
          if (closed) return;
          const revision = runStore.get(id)?.revision ?? run.revision;
          const payload = event && typeof event === "object" && !Array.isArray(event)
            ? { ...event, revision }
            : { type: "message", event, revision };
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)); } catch { closed = true; }
        };
        const close = () => {
          if (closed) return;
          closed = true; unsubscribe(); if (heartbeat) clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        };
        unsubscribe = registry.subscribe(id, send);
        for (const event of registry.events(id)) send(event);
        send({ type: "connected", runId: id, timestamp: new Date().toISOString() });
        heartbeat = setInterval(() => send({ type: "heartbeat", timestamp: new Date().toISOString() }), 15_000);
        request.signal.addEventListener("abort", close, { once: true });
      },
      cancel() { unsubscribe(); if (heartbeat) clearInterval(heartbeat); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  } catch (error) {
    return designErrorResponse(error);
  }
}
