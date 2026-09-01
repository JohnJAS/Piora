import { spawn, type ChildProcess } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "./file-access";

const MAX_OUTPUT_CHARS = 500_000;
const MAX_COMMAND_CHARS = 64 * 1024;
const IDLE_DISPOSE_MS = 20 * 60 * 1_000;

export type TerminalEvent =
  | { type: "clear"; revision: number }
  | { type: "output"; output: string; revision: number }
  | { type: "status"; connected: boolean; revision: number; shell: string };

export interface TerminalSnapshot {
  connected: boolean;
  cwd: string;
  output: string;
  revision: number;
  shell: string;
}

type TerminalListener = (event: TerminalEvent) => void;

export class TerminalSessionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "invalid_terminal_request",
  ) {
    super(message);
    this.name = "TerminalSessionError";
  }
}

function shellDefinition(): { executable: string; args: string[]; label: string } {
  const configured = process.env.PI_TERMINAL_SHELL?.trim();
  if (configured) {
    return { executable: configured, args: [], label: path.basename(configured) };
  }
  if (process.platform === "win32") {
    const executable = process.env.ComSpec?.trim() || process.env.COMSPEC?.trim() || "cmd.exe";
    return { executable, args: ["/D", "/Q", "/K"], label: path.win32.basename(executable) };
  }
  const executable = process.env.SHELL?.trim() || "/bin/sh";
  const label = path.basename(executable);
  return { executable, args: [], label };
}

function terminalKey(cwd: string): string {
  const normalized = isWindowsAbsolutePath(cwd) ? path.win32.resolve(cwd) : path.resolve(cwd);
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

export async function validateTerminalCwd(value: unknown): Promise<string> {
  const cwd = typeof value === "string" ? value.trim() : "";
  if (!cwd || (!path.isAbsolute(cwd) && !isWindowsAbsolutePath(cwd))) {
    throw new TerminalSessionError("cwd must be an absolute path");
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(cwd, allowedRoots)) {
    throw new TerminalSessionError("Access denied", 403, "access_denied");
  }
  let stat;
  try {
    stat = statSync(cwd);
  } catch {
    throw new TerminalSessionError("Directory not found", 404, "directory_not_found");
  }
  if (!stat.isDirectory()) throw new TerminalSessionError("cwd must be a directory");
  return isWindowsAbsolutePath(cwd) ? path.win32.resolve(cwd) : path.resolve(cwd);
}

export class TerminalSession {
  private child: ChildProcess | null = null;
  private connected = false;
  private generation = 0;
  private listeners = new Set<TerminalListener>();
  private output = "";
  private revision = 0;
  private shell = "";
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(readonly cwd: string) {}

  snapshot(): TerminalSnapshot {
    return {
      connected: this.connected,
      cwd: this.cwd,
      output: this.output,
      revision: this.revision,
      shell: this.shell,
    };
  }

  start(): TerminalSnapshot {
    this.touch();
    if (this.child && this.connected) return this.snapshot();

    const definition = shellDefinition();
    const generation = ++this.generation;
    this.shell = definition.label;
    const child = spawn(definition.executable, definition.args, {
      cwd: this.cwd,
      env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR || "1", TERM: process.env.TERM || "xterm-256color" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.connected = true;
    this.append(`\u001b[2mPiora terminal · ${definition.label} · ${this.cwd}\u001b[0m\r\n`);
    this.emitStatus();

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string | Buffer) => {
      if (generation === this.generation) this.append(String(chunk));
    });
    child.stderr?.on("data", (chunk: string | Buffer) => {
      if (generation === this.generation) this.append(String(chunk));
    });
    child.once("error", (error) => {
      if (generation !== this.generation) return;
      this.append(`\r\n\u001b[31m${error.message}\u001b[0m\r\n`);
      this.connected = false;
      this.child = null;
      this.emitStatus();
    });
    child.once("close", (code, signal) => {
      if (generation !== this.generation) return;
      this.connected = false;
      this.child = null;
      const detail = signal ? `signal ${signal}` : `code ${String(code ?? 0)}`;
      this.append(`\r\n\u001b[2m[terminal exited: ${detail}]\u001b[0m\r\n`);
      this.emitStatus();
    });
    return this.snapshot();
  }

  run(rawCommand: unknown): TerminalSnapshot {
    const command = typeof rawCommand === "string" ? rawCommand.trim() : "";
    if (!command) throw new TerminalSessionError("command is required");
    if (command.length > MAX_COMMAND_CHARS) throw new TerminalSessionError("command is too large", 413, "command_too_large");
    if (command.includes("\0")) throw new TerminalSessionError("command contains an invalid null byte");
    this.start();
    if (!this.child?.stdin?.writable) throw new TerminalSessionError("Shell is not available", 409, "shell_unavailable");
    this.append(`\r\n\u001b[36m❯\u001b[0m ${command}\r\n`);
    this.child.stdin.write(`${command}${process.platform === "win32" ? "\r\n" : "\n"}`);
    this.touch();
    return this.snapshot();
  }

  clear(): TerminalSnapshot {
    this.output = "";
    this.revision += 1;
    this.emit({ type: "clear", revision: this.revision });
    this.touch();
    return this.snapshot();
  }

  restart(): TerminalSnapshot {
    this.stop(false);
    return this.start();
  }

  stop(announce = true): TerminalSnapshot {
    this.touch();
    const child = this.child;
    this.generation += 1;
    this.child = null;
    this.connected = false;
    if (child && !child.killed) child.kill();
    if (announce) this.append("\r\n\u001b[2m[terminal stopped]\u001b[0m\r\n");
    this.emitStatus();
    return this.snapshot();
  }

  subscribe(listener: TerminalListener): () => void {
    this.listeners.add(listener);
    this.touch();
    return () => {
      this.listeners.delete(listener);
      this.touch();
    };
  }

  dispose(): void {
    this.stop(false);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.listeners.clear();
  }

  private append(chunk: string): void {
    if (!chunk) return;
    this.output = `${this.output}${chunk}`;
    if (this.output.length > MAX_OUTPUT_CHARS) this.output = this.output.slice(-MAX_OUTPUT_CHARS);
    this.revision += 1;
    this.emit({ type: "output", output: chunk, revision: this.revision });
    this.touch();
  }

  private emitStatus(): void {
    this.revision += 1;
    this.emit({ type: "status", connected: this.connected, revision: this.revision, shell: this.shell });
  }

  private emit(event: TerminalEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.listeners.size > 0) {
        this.touch();
        return;
      }
      terminalSessions().delete(terminalKey(this.cwd));
      this.dispose();
    }, IDLE_DISPOSE_MS);
    this.idleTimer.unref?.();
  }
}

declare global {
  var __pioraTerminalSessions: Map<string, TerminalSession> | undefined;
}

function terminalSessions(): Map<string, TerminalSession> {
  return globalThis.__pioraTerminalSessions ??= new Map();
}

export function getTerminalSession(cwd: string): TerminalSession {
  const key = terminalKey(cwd);
  const existing = terminalSessions().get(key);
  if (existing) return existing;
  const created = new TerminalSession(cwd);
  terminalSessions().set(key, created);
  return created;
}

export function resetTerminalSessionsForTests(): void {
  for (const session of terminalSessions().values()) session.dispose();
  terminalSessions().clear();
}
