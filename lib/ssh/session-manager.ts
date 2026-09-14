import { randomUUID } from "node:crypto";
import { Client, type ClientChannel, type SFTPWrapper } from "ssh2";
import type { SSHConnectionOptions, SSHSessionEvent, SSHSessionSnapshot } from "./types";

type Listener = (event: SSHSessionEvent) => void;

export class SSHSession {
  private readonly client = new Client();
  private channel: ClientChannel | null = null;
  private sftpClient: SFTPWrapper | null = null;
  private readonly listeners = new Set<Listener>();
  private currentCwd = "~";
  private connected = false;
  readonly id = randomUUID();
  mode: SSHSessionSnapshot["mode"] = "independent";
  agentSessionId?: string;

  constructor(private readonly options: SSHConnectionOptions) {}

  snapshot(): SSHSessionSnapshot {
    return { id: this.id, host: this.options.host, port: this.options.port ?? 22, username: this.options.username, cwd: this.currentCwd, connected: this.connected, mode: this.mode, ...(this.agentSessionId ? { agentSessionId: this.agentSessionId } : {}) };
  }

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(event: SSHSessionEvent): void { for (const listener of this.listeners) { try { listener(event); } catch { /* detached client */ } } }

  async connect(): Promise<void> {
    if (this.connected) return;
    await new Promise<void>((resolve, reject) => {
      this.client.once("ready", () => {
        this.connected = true;
        this.emit({ type: "status", connected: true });
        void this.openShell().then(resolve, reject);
      });
      this.client.once("error", error => { this.emit({ type: "status", connected: false, error: error.message }); reject(error); });
      this.client.once("close", () => { this.connected = false; this.channel = null; this.sftpClient = null; this.emit({ type: "status", connected: false }); });
      this.client.connect({ host: this.options.host, port: this.options.port ?? 22, username: this.options.username, ...(this.options.auth.type === "password" ? { password: this.options.auth.password } : { privateKey: this.options.auth.privateKey, passphrase: this.options.auth.passphrase }), readyTimeout: 15_000 });
    });
  }

  private async openShell(): Promise<void> {
    await new Promise<void>((resolve, reject) => this.client.shell({ term: "xterm-256color", cols: this.options.cols ?? 100, rows: this.options.rows ?? 30 }, (error, channel) => {
      if (error) return reject(error);
      this.channel = channel;
      channel.on("data", (data: Buffer) => this.emit({ type: "output", data: data.toString("utf8") }));
      channel.on("close", () => { this.channel = null; });
      resolve();
    }));
  }

  write(data: string): void { if (!this.channel) throw new Error("SSH session is not connected"); this.channel.write(data); }
  async exec(command: string): Promise<{ output: string; exitCode: number | null }> {
    await this.connect();
    return new Promise((resolve, reject) => this.client.exec(`cd ${JSON.stringify(this.currentCwd)} && ${command}`, (error, channel) => {
      if (error) return reject(error);
      const chunks: Buffer[] = [];
      channel.on("data", (data: Buffer) => { chunks.push(data); this.emit({ type: "output", data: data.toString("utf8") }); });
      channel.stderr.on("data", (data: Buffer) => { chunks.push(data); this.emit({ type: "output", data: data.toString("utf8") }); });
      channel.on("close", (code: number | null) => resolve({ output: Buffer.concat(chunks).toString("utf8"), exitCode: code }));
    }));
  }
  bindAgent(agentSessionId: string): void { this.mode = "agent-controlled"; this.agentSessionId = agentSessionId; this.emit({ type: "snapshot", snapshot: this.snapshot() }); }
  unbindAgent(): void { this.mode = "independent"; delete this.agentSessionId; this.emit({ type: "snapshot", snapshot: this.snapshot() }); }
  async sftp(): Promise<SFTPWrapper> { if (this.sftpClient) return this.sftpClient; await this.connect(); const value = await new Promise<SFTPWrapper>((resolve, reject) => this.client.sftp((error, result) => error ? reject(error) : resolve(result))); this.sftpClient = value; return value; }
  close(): void { this.channel?.close(); this.client.end(); this.connected = false; }
}

const sessions = new Map<string, SSHSession>();
export function createSSHSession(options: SSHConnectionOptions): SSHSession { const session = new SSHSession(options); sessions.set(session.id, session); return session; }
export function getSSHSession(id: string): SSHSession | undefined { return sessions.get(id); }
export function closeSSHSession(id: string): void { sessions.get(id)?.close(); sessions.delete(id); }
