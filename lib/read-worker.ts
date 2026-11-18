import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

interface PendingJob {
  resolve(result: unknown): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

class ReadWorker {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingJob | null>();
  private sequence = 0;
  failed = false;

  constructor() {
    const root = process.env.PIORA_WEB_RUNTIME_ROOT?.trim() || process.cwd();
    const directory = root.endsWith(".asar") ? root + ".unpacked" : root;
    const entry = join(directory, "lib", "read-runtime", "worker.mjs");
    if (!existsSync(entry)) throw new Error("Local read worker is missing");
    // The entry is staged alongside the runtime and is resolved by Node.
    this.worker = Reflect.construct(Worker, [pathToFileURL(entry)]) as Worker;
    this.worker.on("message", ({ id, result, error }: { id: number; result?: unknown; error?: { message: string; code?: string } }) => {
      const request = this.take(id);
      if (error) request?.reject(Object.assign(new Error(error.message), { code: error.code }));
      else request?.resolve(result);
    });
    this.worker.once("error", (error) => this.fail(error instanceof Error ? error : new Error(String(error))));
    this.worker.once("exit", (code) => this.fail(new Error("Local read worker exited (" + code + ")")));
    this.worker.unref();
  }

  private take(id: number): PendingJob | undefined {
    const request = this.pending.get(id);
    this.pending.delete(id);
    if (request?.onAbort) request.signal?.removeEventListener("abort", request.onAbort);
    if (!this.pending.size) this.worker.unref();
    return request ?? undefined;
  }

  private fail(error: Error): void {
    this.failed = true;
    for (const id of this.pending.keys()) this.take(id)?.reject(error);
  }

  run<Result>(operation: string, data: object, signal?: AbortSignal): Promise<Result> {
    if (this.failed) return Promise.reject(new Error("Local read worker is unavailable"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.pending.size >= 128) return Promise.reject(new Error("Local read queue is full"));
    const id = ++this.sequence;
    const cancel = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    return new Promise<Result>((resolve, reject) => {
      const onAbort = signal && (() => {
        Atomics.store(cancel, 0, 1);
        this.pending.set(id, null);
        reject(signal.reason);
      });
      this.pending.set(id, { resolve: (value) => resolve(value as Result), reject, signal, onAbort });
      if (onAbort) signal?.addEventListener("abort", onAbort, { once: true });
      this.worker.ref();
      try { this.worker.postMessage({ id, operation, data, cancel }); }
      catch (error) { this.take(id); reject(error); }
    });
  }
}

declare global {
  var __pioraReadWorker: ReadWorker | undefined;
  var __pioraFileReadWorker: ReadWorker | undefined;
}

export function readInWorker<Result>(operation: string, data: object, signal?: AbortSignal): Promise<Result> {
  if (operation.startsWith("file")) {
    if (!globalThis.__pioraFileReadWorker || globalThis.__pioraFileReadWorker.failed) globalThis.__pioraFileReadWorker = new ReadWorker();
    return globalThis.__pioraFileReadWorker.run<Result>(operation, data, signal);
  }
  if (!globalThis.__pioraReadWorker || globalThis.__pioraReadWorker.failed) globalThis.__pioraReadWorker = new ReadWorker();
  return globalThis.__pioraReadWorker.run<Result>(operation, data, signal);
}
