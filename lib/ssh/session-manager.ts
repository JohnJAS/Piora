import { randomUUID, randomBytes, createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { Client, type ClientChannel, type SFTPWrapper } from "ssh2";
import type { SSHConnectionOptions, SSHSessionEvent, SSHSessionSnapshot } from "./types";

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
  private readonly decoder = new StringDecoder("utf8");
  private execution: { output: string; onData?: (data: Buffer) => void; finish: (error?: Error, code?: number) => void } | null = null;
  private connected = false;
  private fingerprint?: string;
  readonly id = randomUUID();
  mode: SSHSessionSnapshot["mode"] = "independent";
  agentSessionId?: string;

  constructor(private readonly options: SSHConnectionOptions) {}

  snapshot(): SSHSessionSnapshot {
    return { id: this.id, host: this.options.host, port: this.options.port ?? 22, username: this.options.username, cwd: this.currentCwd, connected: this.connected, output: this.output, mode: this.mode, ...(this.agentSessionId ? { agentSessionId: this.agentSessionId } : {}), ...(this.fingerprint ? { hostFingerprint: this.fingerprint } : {}) };
  }

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: SSHSessionEvent): void { for (const listener of this.listeners) { try { listener(event); } catch { /* detached client */ } } }

  async connect(): Promise<void> {
    if (this.connected) return;
    const client = new Client();
    this.client = client;
    await new Promise<void>((resolve, reject) => {
      client.once("ready", () => {
        this.connected = true;
        this.emit({ type: "status", connected: true });
        void this.openShell(client).then(resolve, reject);
      });
      client.once("error", error => { this.emit({ type: "status", connected: false, error: error.message }); reject(error); });
      client.once("close", () => { this.connected = false; this.channel = null; this.sftpClient = null; if (this.client === client) this.client = null; this.emit({ type: "status", connected: false }); });
      client.connect({ host: this.options.host, port: this.options.port ?? 22, username: this.options.username, ...(this.options.auth.type === "password" ? { password: this.options.auth.password } : { privateKey: this.options.auth.privateKey, passphrase: this.options.auth.passphrase }), hostVerifier: (key: Buffer) => {
        const fingerprint = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
        this.fingerprint = fingerprint;
        const identity = `${this.options.host}:${this.options.port ?? 22}`;
        const expected = this.options.hostFingerprint ?? trustedHosts.get(identity);
        if (expected && expected !== fingerprint) return false;
        trustedHosts.set(identity, fingerprint);
        return true;
      }, readyTimeout: 15_000 });
    });
  }

  private async openShell(client: Client): Promise<void> {
    await new Promise<void>((resolve, reject) => client.shell({ term: "xterm-256color", cols: this.options.cols ?? 100, rows: this.options.rows ?? 30 }, (error, channel) => {
      if (error) return reject(error);
      this.channel = channel;
      channel.on("data", (data: Buffer) => this.receive(this.decoder.write(data)));
      channel.on("close", () => { this.channel = null; this.execution?.finish(new Error("SSH shell closed")); });
      resolve();
    }));
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
        clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
        if (error) reject(error); else resolve({ output, exitCode: code ?? null });
      } };
      options.signal?.addEventListener("abort", cancel, { once: true });
      // eval runs in the existing interactive POSIX shell: cwd and exports persist.
      const quoted = `'${command.replace(/'/g, `'"'"'`)}'`;
      const format = this.marker.replace("\x1b", "\\033") + "%s;%s\\007";
      this.channel!.write(`eval ${quoted}; __piora_status=$?; printf '${format}' "$__piora_status" "$PWD"\n`);
    });
  }
  bindAgent(agentSessionId: string): void { this.mode = "agent-controlled"; this.agentSessionId = agentSessionId; this.emit({ type: "snapshot", snapshot: this.snapshot() }); }
  unbindAgent(): void { this.mode = "independent"; delete this.agentSessionId; this.emit({ type: "snapshot", snapshot: this.snapshot() }); }
  async sftp(): Promise<SFTPWrapper> { if (this.sftpClient) return this.sftpClient; await this.connect(); if (!this.client) throw new Error("SSH is disconnected"); const value = await new Promise<SFTPWrapper>((resolve, reject) => this.client!.sftp((error, result) => error ? reject(error) : resolve(result))); this.sftpClient = value; return value; }
  close(): void { this.execution?.finish(new Error("SSH session closed")); this.channel?.close(); this.client?.end(); this.client = null; this.connected = false; }
}

declare global { var __pioraSSHSessions: Map<string, SSHSession> | undefined; var __pioraSSHTrustedHosts: Map<string, string> | undefined; }
const sessions = globalThis.__pioraSSHSessions ??= new Map<string, SSHSession>();
const trustedHosts = globalThis.__pioraSSHTrustedHosts ??= new Map<string, string>();
export function createSSHSession(options: SSHConnectionOptions): SSHSession { const session = new SSHSession(options); sessions.set(session.id, session); return session; }
export function listSSHSessions(): SSHSessionSnapshot[] { return [...sessions.values()].map(session => session.snapshot()); }
export function getSSHSession(id: string): SSHSession | undefined { return sessions.get(id); }
export function closeSSHSession(id: string): void { sessions.get(id)?.close(); sessions.delete(id); }
export function getSSHSessionForAgent(agentSessionId: string): SSHSession | undefined {
  for (const session of sessions.values()) if (session.agentSessionId === agentSessionId) return session;
  return undefined;
}
