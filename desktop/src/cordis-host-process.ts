import { execFile, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Json } from "./cordis-extension-contract.js";
import type { HostAction, HostCancel, HostRequest, HostResponse, HostServiceRequest } from "./cordis-host-protocol.js";

interface Pending { finish: (error: Error | null, value?: Json) => void }

export class CordisHostProcess {
  private readonly child: ChildProcess;
  private readonly requests = new Map<number, Pending>();
  private readonly services = new Map<number, AbortController>();
  private sequence = 0;
  private exited = false;
  private stopping = false;
  private disposal: Promise<void> | undefined;

  constructor(options: {
    worker: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    receiveService: (message: HostServiceRequest, signal: AbortSignal) => Promise<Json>;
    onExit: (reason: string) => void;
  }) {
    const child = this.child = spawn(process.execPath, [options.worker], {
      cwd: options.cwd, env: options.env, stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true, detached: process.platform !== "win32",
    });
    const fail = (reason: string) => {
      if (this.exited) return;
      this.exited = true;
      for (const pending of this.requests.values()) pending.finish(new Error(reason));
      for (const controller of this.services.values()) controller.abort();
      this.services.clear();
      if (!this.stopping) options.onExit(reason);
    };
    child.on("error", error => fail("Could not run the Cordis process: " + error.message));
    child.on("exit", (code, signal) => fail("Cordis process exited (" + (code ?? signal ?? "unknown") + ")"));
    child.on("message", (message: HostResponse | HostServiceRequest | HostCancel) => {
      if (message.type === "result") this.requests.get(message.id)?.finish(message.error ? new Error(message.error) : null, message.value);
      else if (message.type === "cancel") this.services.get(message.id)?.abort();
      else if (message.type === "service" && !this.stopping) {
        if (this.services.size >= 16 || this.services.has(message.id)) {
          this.send({ type: "result", id: message.id, error: "Too many pending Cordis service requests" });
          return;
        }
        const controller = new AbortController();
        this.services.set(message.id, controller);
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(message.service === "model" ? 120_000 : 10_000)]);
        void Promise.resolve().then(() => options.receiveService(message, signal)).then(
          value => this.send({ type: "result", id: message.id, value }),
          error => this.send({ type: "result", id: message.id, error: (error instanceof Error ? error.message : String(error)).slice(0, 700) }),
        ).finally(() => { this.services.delete(message.id); });
      }
    });
  }

  get alive(): boolean { return !this.exited && this.child.connected && this.child.exitCode === null && this.child.signalCode === null; }

  private send(message: HostResponse | HostRequest | HostCancel, onError?: (error: Error) => void) {
    if (!this.child.connected) { onError?.(new Error("The Cordis process disconnected")); return; }
    try { this.child.send(message, error => { if (error) onError?.(error); }); }
    catch (error) { onError?.(error as Error); }
  }

  async request(action: HostAction, signal: AbortSignal, timeoutMs: number): Promise<Json> {
    signal.throwIfAborted();
    if (!this.alive) throw new Error("The Cordis process is unavailable");
    if (this.requests.size >= 16) throw new Error("Too many pending extension RPC requests");
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const cancel = (reason: Error) => {
        this.send({ type: "cancel", id });
        finish(reason);
      };
      const abort = () => cancel(signal.reason instanceof Error ? signal.reason : new Error("Extension request cancelled"));
      const timer = setTimeout(() => cancel(new Error("Extension request timed out")), timeoutMs);
      const finish = (error: Error | null, value?: Json) => {
        if (!this.requests.delete(id)) return;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(value ?? null);
      };
      signal.addEventListener("abort", abort, { once: true });
      this.requests.set(id, { finish });
      this.send({ ...action, type: "request", id }, finish);
    });
  }

  stop(): Promise<void> {
    this.disposal ??= this.stopProcess();
    return this.disposal;
  }

  private async stopProcess(): Promise<void> {
    this.stopping = true;
    for (const controller of this.services.values()) controller.abort();
    try {
      if (this.alive) await this.request({ action: "dispose" }, AbortSignal.timeout(2500), 2000);
    } catch { /* A hung extension cannot block its parent desktop process. */ }
    if (this.child.connected) this.child.disconnect();
    if (await this.waitForExit(1250)) return;
    const pid = this.child.pid;
    if (pid && process.platform === "win32") {
      const taskkill = join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
      await new Promise<void>(resolve => {
        execFile(taskkill, ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 2500 }, () => resolve());
      });
    } else if (pid) {
      try { process.kill(-pid, "SIGKILL"); } catch { this.child.kill(); }
    }
    if (!await this.waitForExit(2000)) throw new Error("The Cordis process did not exit");
  }

  private async waitForExit(timeoutMs: number) {
    const end = Date.now() + timeoutMs;
    while (!this.exited && Date.now() < end) await delay(40);
    return this.exited;
  }
}
