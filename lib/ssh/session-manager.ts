import { randomUUID, randomBytes } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { Client, type ClientChannel, type SFTPWrapper } from "ssh2";
import type { SSHConnectionOptions, SSHSessionEvent, SSHSessionSnapshot } from "./types";
import { authenticateSSH } from "./connection";

type Listener = (event: SSHSessionEvent) => void;

export class SSHSession {
  private client: Client | null = null;
  private channel: ClientChannel | null = null;
  private sftpClient: SFTPWrapper | null = null;
  private readonly listeners = new Set<Listener>();
  private currentCwd = ".";
  private output = "";
  private pending = "";
  private readonly marker = `\x1b]633;Piora;${randomBytes(24).toString("hex")};`;
  private decoder = new StringDecoder("utf8");
  private execution: { output: string; onData?: (data: Buffer) => void; finish: (error?: Error, code?: number) => void } | null = null;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private connectionAbort: AbortController | null = null;
  private fingerprint?: string;
  readonly id = randomUUID();
  mode: SSHSessionSnapshot["mode"] = "independent";
  agentSessionId?: string;

  constructor(private readonly options: SSHConnectionOptions) {}

  snapshot(): SSHSessionSnapshot {
    return { id: this.id, host: this.options.host, port: this.options.port ?? 22, username: this.options.username, cwd: this.currentCwd, connected: this.connected, busy: !!this.execution, output: this.output, mode: this.mode, ...(this.agentSessionId ? { agentSessionId: this.agentSessionId } : {}), ...(this.fingerprint ? { hostFingerprint: this.fingerprint } : {}) };
  }

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: SSHSessionEvent): void { for (const listener of this.listeners) { try { listener(event); } catch { /* detached client */ } } }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    const abort = new AbortController();
    this.connectionAbort = abort;
    const work = (async () => {
      const { client, fingerprint } = await authenticateSSH(this.options, abort.signal);
      if (abort.signal.aborted) { client.destroy(); throw new Error("SSH connection cancelled"); }
      this.client = client;
      this.fingerprint = fingerprint;
      const disconnected = (error?: Error) => {
        if (this.client !== client) return;
        this.client = null; this.channel = null; this.sftpClient = null; this.connected = false;
        this.execution?.finish(error ?? new Error("SSH connection closed"));
        this.emit({ type: "status", connected: false, ...(error ? { error: error.message } : {}) });
        client.destroy();
      };
      client.on("error", disconnected);
      client.once("close", () => disconnected());
      try {
        await this.openShell(client);
        if (this.client !== client || abort.signal.aborted) throw new Error("SSH connection closed");
        this.connected = true;
        this.emit({ type: "status", connected: true });
      } catch (error) { disconnected(error instanceof Error ? error : new Error(String(error))); throw error; }
    })();
    this.connecting = work;
    try { await work; }
    finally { if (this.connecting === work) { this.connecting = null; this.connectionAbort = null; } }
  }

  private async openShell(client: Client): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const closed = () => finish(new Error("SSH connection closed before the shell opened"));
      const timer = setTimeout(() => finish(new Error("SSH shell request timed out")), 15_000);
      const finish = (error?: Error) => { clearTimeout(timer); client.removeListener("close", closed); if (error) reject(error); else resolve(); };
      client.once("close", closed);
      client.shell({ term: "xterm-256color", cols: this.options.cols ?? 100, rows: this.options.rows ?? 30 }, (error, channel) => {
      if (error) return finish(error);
      if (this.client !== client) { channel.close(); return finish(new Error("SSH connection closed")); }
      this.channel = channel;
      this.pending = "";
      this.decoder = new StringDecoder("utf8");
      this.currentCwd = ".";
      this.emit({ type: "cwd", cwd: "." });
      channel.on("data", (data: Buffer) => this.receive(this.decoder.write(data)));
      const stderr = new StringDecoder("utf8");
      channel.stderr.on("data", (data: Buffer) => this.append(stderr.write(data)));
      channel.on("close", () => { if (this.channel === channel) this.close(); });
      finish();
      });
    });
  }

  private append(data: string): void {
    if (!data) return;
    this.output = (this.output + data).slice(-500_000);
    if (this.execution) { this.execution.output = (this.execution.output + data).slice(-500_000); this.execution.onData?.(Buffer.from(data)); }
    this.emit({ type: "output", data });
  }
  private receive(data: string): void {
    this.pending += data;
    for (;;) {
      const start = this.pending.indexOf(this.marker);
      if (start < 0) {
        let keep = Math.min(this.pending.length, this.marker.length - 1);
        while (keep && !this.marker.startsWith(this.pending.slice(-keep))) keep--;
        this.append(this.pending.slice(0, this.pending.length - keep));
        this.pending = keep ? this.pending.slice(-keep) : "";
        return;
      }
      this.append(this.pending.slice(0, start)); this.pending = this.pending.slice(start);
      const end = this.pending.indexOf("\x07");
      if (end < 0) return;
      const content = this.pending.slice(this.marker.length, end);
      this.pending = this.pending.slice(end + 1);
      const separator = content.indexOf(";");
      if (separator < 0) continue;
      const code = Number(content.slice(0, separator));
      this.currentCwd = content.slice(separator + 1);
      this.emit({ type: "cwd", cwd: this.currentCwd });
      this.execution?.finish(undefined, code);
    }
  }
  write(data: string): void {
    if (!this.channel) throw new Error("SSH session is not connected");
    if (this.execution) throw new Error("A model command is running; stop it before entering terminal input");
    // Interactive commands can change cwd without a shell integration marker.
    if (this.currentCwd !== ".") { this.currentCwd = "."; this.emit({ type: "cwd", cwd: "." }); }
    this.channel.write(data);
  }
  resize(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 1000 || rows > 1000) throw new Error("Invalid terminal size");
    this.channel?.setWindow(rows, cols, 0, 0);
  }
  async exec(command: string, options: { signal?: AbortSignal; timeout?: number; onData?: (data: Buffer) => void } = {}): Promise<{ output: string; exitCode: number | null }> {
    options.signal?.throwIfAborted();
    if (!this.channel || !this.connected) throw new Error("SSH is disconnected; reconnect before running a command");
    if (this.execution) throw new Error("SSH terminal is busy");
    if (!command.trim() || command.includes("\0")) throw new Error("Invalid SSH command");
    return new Promise((resolve, reject) => {
      const cancel = () => { this.execution?.finish(new Error("SSH command interrupted; reconnect before continuing")); this.close(); };
      const timer = setTimeout(cancel, Math.min(options.timeout ?? 120, 3600) * 1000);
      this.execution = { output: "", onData: options.onData, finish: (error, code) => {
        const output = this.execution?.output ?? ""; this.execution = null;
        this.emit({ type: "busy", busy: false });
        clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
        if (error) reject(error); else resolve({ output, exitCode: code ?? null });
      } };
      this.emit({ type: "busy", busy: true });
      options.signal?.addEventListener("abort", cancel, { once: true });
      // eval runs in the existing interactive POSIX shell: cwd and exports persist.
      const quoted = `'${command.replace(/'/g, `'"'"'`)}'`;
      const format = this.marker.replace("\x1b", "\\033") + "%s;%s\\007";
      this.channel!.write(`eval ${quoted}; __piora_status=$?; printf '${format}' "$__piora_status" "$PWD"\n`);
    });
  }
  bindAgent(agentSessionId: string): void { this.mode = "agent-controlled"; this.agentSessionId = agentSessionId; this.emit({ type: "snapshot", snapshot: this.snapshot() }); }
  unbindAgent(): void { this.mode = "independent"; delete this.agentSessionId; this.emit({ type: "snapshot", snapshot: this.snapshot() }); }
  clearOutput(): void { this.output = ""; this.emit({ type: "clear" }); }
  async sftp(): Promise<SFTPWrapper> {
    if (!this.client || !this.connected) throw new Error("SSH is disconnected");
    if (this.sftpClient) return this.sftpClient;
    const client = this.client;
    const value = await new Promise<SFTPWrapper>((resolve, reject) => client.sftp((error, result) => error ? reject(error) : resolve(result)));
    if (client !== this.client) { value.end(); throw new Error("SSH is disconnected"); }
    this.sftpClient = value; return value;
  }
  close(): void {
    this.connectionAbort?.abort();
    this.execution?.finish(new Error("SSH session closed"));
    const client = this.client, channel = this.channel;
    this.client = null; this.channel = null; this.sftpClient = null; this.connected = false;
    channel?.close(); client?.end();
    this.emit({ type: "status", connected: false });
  }
}

declare global { var __pioraSSHSessions: Map<string, SSHSession> | undefined; }
const sessions = globalThis.__pioraSSHSessions ??= new Map<string, SSHSession>();
export function createSSHSession(options: SSHConnectionOptions): SSHSession { const session = new SSHSession(options); sessions.set(session.id, session); return session; }
export function listSSHSessions(): SSHSessionSnapshot[] { return [...sessions.values()].map(session => session.snapshot()); }
export function getSSHSession(id: string): SSHSession | undefined { return sessions.get(id); }
export function closeSSHSession(id: string): void { sessions.get(id)?.close(); sessions.delete(id); }
export function getSSHSessionForAgent(agentSessionId: string): SSHSession | undefined {
  for (const session of sessions.values()) if (session.agentSessionId === agentSessionId) return session;
  return undefined;
}
