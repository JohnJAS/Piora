type DesktopBrowserRpcContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/png" };

export interface DesktopBrowserRpcResult {
  content: DesktopBrowserRpcContent[];
  details: Record<string, unknown>;
}

type DesktopBrowserRpcResponse = {
  type: "pi-desktop:browser-response";
  requestId: string;
  ok: boolean;
  result?: DesktopBrowserRpcResult;
  error?: string;
};

type PendingRequest = {
  resolve: (value: DesktopBrowserRpcResult) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

type DesktopBrowserRpcRuntime = {
  pending: Map<string, PendingRequest>;
  listening: boolean;
  sequence: number;
};

declare global {
  var __pioraDesktopBrowserRpc: DesktopBrowserRpcRuntime | undefined;
}

const runtime = globalThis.__pioraDesktopBrowserRpc ??= {
  pending: new Map(),
  listening: false,
  sequence: 0,
};

function isResponse(message: unknown): message is DesktopBrowserRpcResponse {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Partial<DesktopBrowserRpcResponse>;
  return candidate.type === "pi-desktop:browser-response"
    && typeof candidate.requestId === "string"
    && typeof candidate.ok === "boolean";
}

function installResponseListener(): void {
  if (runtime.listening || typeof process.on !== "function") return;
  runtime.listening = true;
  process.on("message", (message: unknown) => {
    if (!isResponse(message)) return;
    const pending = runtime.pending.get(message.requestId);
    if (!pending) return;
    runtime.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.ok && message.result) pending.resolve(message.result);
    else pending.reject(new Error(message.error || "The desktop browser request failed."));
  });
}

export function desktopBrowserRpcAvailable(): boolean {
  return typeof process.send === "function"
    && Boolean(process.env.PI_DESKTOP_TOKEN)
    && process.env.PIORA_RUNTIME_PROFILE !== "web";
}

export async function requestDesktopBrowser(
  sessionId: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<DesktopBrowserRpcResult> {
  if (!desktopBrowserRpcAvailable() || !process.send) {
    throw new Error("The visible desktop browser is unavailable in this runtime.");
  }
  if (!sessionId || sessionId.length > 512) throw new Error("A valid browser session id is required.");
  if (signal?.aborted) throw new Error("Browser action aborted");
  installResponseListener();

  const requestId = `${process.pid}-${Date.now().toString(36)}-${(++runtime.sequence).toString(36)}`;
  return await new Promise<DesktopBrowserRpcResult>((resolve, reject) => {
    const cleanup = () => {
      const pending = runtime.pending.get(requestId);
      if (!pending) return;
      runtime.pending.delete(requestId);
      clearTimeout(pending.timer);
    };
    const abort = () => {
      cleanup();
      try { process.send?.({ type: "pi-desktop:browser-cancel", requestId }); } catch { /* The desktop process may already be stopping. */ }
      reject(new Error("Browser action aborted"));
    };
    const timer = setTimeout(() => {
      runtime.pending.delete(requestId);
      signal?.removeEventListener("abort", abort);
      reject(new Error("The visible desktop browser did not respond within 45 seconds."));
    }, 45_000);
    timer.unref?.();
    runtime.pending.set(requestId, {
      resolve: (value) => {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      reject: (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
      timer,
    });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      process.send?.({
        type: "pi-desktop:browser-request",
        requestId,
        sessionId,
        params,
      });
    } catch (error) {
      cleanup();
      signal?.removeEventListener("abort", abort);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
