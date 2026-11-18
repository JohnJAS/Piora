import { appendFileSync, chmodSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionCommandEvent, SessionCommandRecord, SessionCommandStatus } from "./session-message-types";
import { recordAnalyticsCommand } from "./analytics-telemetry";
import { endsInNewline, fileRevision, lastJsonLine } from "./jsonl-file-index";
import {
  findJournalCommand, indexJournalAppend, queryCommandById, queryCommandByKey, querySlashReceipts, readActiveCommands, readAllCommands, readJournalEvents,
  readArchivePage, readOperationsPage, readOperationWindow, readSlashReceipts, readTaskTimings, resetSessionControlReadIndex,
  type CommandJournalEntry, type CommandPageOptions, type EventJournalEntry,
} from "./session-control-read-index";

declare global {
  var __pioraSessionControlWriteLocks: Map<string, Promise<void>> | undefined;
  var __pioraSessionControlCursors: Map<string, { revision: string; cursor: number }> | undefined;
}

function writeLocks(): Map<string, Promise<void>> {
  return globalThis.__pioraSessionControlWriteLocks ??= new Map();
}

function cursors() {
  return globalThis.__pioraSessionControlCursors ??= new Map();
}

function safeSessionFileName(sessionId: string): string {
  return Buffer.from(sessionId, "utf8").toString("base64url");
}

function persistLines(kind: "commands" | "events", path: string, line: string) {
  const before = statSync(path, { throwIfNoEntry: false });
  let aligned = true;
  if (before?.size) {
    const descriptor = openSync(path, "r");
    try { aligned = endsInNewline(descriptor, before.size); }
    finally { closeSync(descriptor); }
  }
  const bytes = Buffer.from((aligned ? "" : "\n") + line + "\n", "utf8");
  appendFileSync(path, bytes, { mode: 0o600, flush: kind === "commands" });
  chmodSync(path, 0o600);
  const after = statSync(path);
  indexJournalAppend(kind, path, before, after, bytes, aligned);
  return after;
}

function readLastCursor(path: string): number {
  const snapshot = statSync(path, { throwIfNoEntry: false });
  const cached = cursors().get(path);
  if (!snapshot) return cached?.cursor ?? 0;
  const revision = fileRevision(snapshot);
  if (cached?.revision === revision) return cached.cursor;
  const descriptor = openSync(path, "r");
  try {
    const state = fstatSync(descriptor);
    const cursor = lastJsonLine<EventJournalEntry, number>(descriptor, state.size, entry =>
      typeof entry.event?.cursor === "number" ? entry.event.cursor : undefined) ?? cached?.cursor ?? 0;
    saveCursor(path, fileRevision(state), cursor);
    return cursor;
  } finally {
    closeSync(descriptor);
  }
}

function saveCursor(path: string, revision: string, cursor: number): void {
  const cache = cursors();
  cache.delete(path);
  cache.set(path, { revision, cursor });
  if (cache.size > 1024) cache.delete(cache.keys().next().value!);
}

async function serializeWrite<T>(path: string, operation: () => T | Promise<T>): Promise<T> {
  const previous = writeLocks().get(path) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  const chain = previous.then(() => current);
  writeLocks().set(path, chain);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writeLocks().get(path) === chain) writeLocks().delete(path);
  }
}

async function appendLocked(path: string, line: string, commit?: (persist: () => void) => void): Promise<void> {
  mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
  await serializeWrite(path, async () => {
    const directory = resolve(path, "..");
    const release = await lockfile.lock(directory, {
      lockfilePath: `${path}.lock`,
      realpath: false,
      retries: { retries: 50, factor: 1.15, minTimeout: 4, maxTimeout: 50 },
    });
    try {
      const persist = () => { persistLines("commands", path, line); };
      if (commit) commit(persist); else persist();
    } finally {
      await release();
    }
  });
}

export interface SessionControlStoreOptions {
  root?: string;
  retentionDays?: number;
  retentionCount?: number;
}

export class SessionControlStore {
  readonly root: string;
  readonly retentionDays: number;
  readonly retentionCount: number;

  constructor(options: SessionControlStoreOptions = {}) {
    this.root = resolve(options.root ?? process.env.PIORA_SESSION_CONTROL_ROOT ?? join(getAgentDir(), "piora", "session-control"));
    this.retentionDays = Math.max(1, Math.min(365, Math.floor(options.retentionDays ?? 30)));
    this.retentionCount = Math.max(100, Math.min(100_000, Math.floor(options.retentionCount ?? 10_000)));
  }

  commandsPath(sessionId: string): string {
    return join(this.root, "commands", `${safeSessionFileName(sessionId)}.jsonl`);
  }

  /** Successful slash commands need not create a user entry in SDK history. */
  completedSlashPromptIds(sessionId: string, keys?: ReadonlySet<string>): string[] {
    return readSlashReceipts(this.commandsPath(sessionId), keys);
  }

  queryCompletedSlashPromptIds(sessionId: string, keys?: ReadonlySet<string>): Promise<string[]> {
    return querySlashReceipts(this.commandsPath(sessionId), keys);
  }

  eventsPath(sessionId: string): string {
    return join(this.root, "events", `${safeSessionFileName(sessionId)}.jsonl`);
  }

  snapshotsPath(sessionId: string): string {
    return join(this.root, "snapshots", `${safeSessionFileName(sessionId)}.json`);
  }

  loadCommands(sessionId: string): SessionCommandRecord[] {
    return readAllCommands(this.commandsPath(sessionId));
  }

  loadActiveCommands(sessionId: string): Promise<SessionCommandRecord[]> {
    return readActiveCommands(this.commandsPath(sessionId));
  }

  operationWindow(sessionId: string, limit = 50) {
    return readOperationWindow(this.commandsPath(sessionId), limit);
  }

  readOperationPage(sessionId: string, options: CommandPageOptions) {
    return readOperationsPage(this.commandsPath(sessionId), options);
  }

  readArchivePage(sessionId: string, offset: number) {
    return readArchivePage(this.commandsPath(sessionId), offset);
  }

  readTaskTimings(sessionId: string, keys: ReadonlySet<string>) {
    return readTaskTimings(this.commandsPath(sessionId), keys);
  }

  queryByCommandId(sessionId: string, commandId: string) {
    return queryCommandById(this.commandsPath(sessionId), commandId);
  }

  queryByIdempotencyKey(sessionId: string, key: string): Promise<SessionCommandRecord | undefined> {
    return queryCommandByKey(this.commandsPath(sessionId), key);
  }

  findByIdempotencyKey(idempotencyKey: string, sessionId?: string): SessionCommandRecord | undefined {
    const commandDir = join(this.root, "commands");
    if (!existsSync(commandDir)) return undefined;
    if (sessionId) {
      return findJournalCommand(this.commandsPath(sessionId), { idempotencyKey });
    }
    for (const entry of readdirSync(commandDir) as string[]) {
      if (!entry.endsWith(".jsonl")) continue;
      const match = findJournalCommand(join(commandDir, entry), { idempotencyKey });
      if (match) return match;
    }
    return undefined;
  }

  findByCommandId(commandId: string, sessionId?: string): SessionCommandRecord | undefined {
    if (sessionId) return findJournalCommand(this.commandsPath(sessionId), { commandId });
    const commandDir = join(this.root, "commands");
    if (!existsSync(commandDir)) return undefined;
    for (const entry of readdirSync(commandDir) as string[]) {
      if (!entry.endsWith(".jsonl")) continue;
      const match = findJournalCommand(join(commandDir, entry), { commandId });
      if (match) return match;
    }
    return undefined;
  }

  async appendRecalledCommands(commands: SessionCommandRecord[], commit: (persist: () => void) => void): Promise<void> {
    if (!commands.length) return;
    if (commands.some(command => command.targetSessionId !== commands[0].targetSessionId || !command.queuePaused)) throw new Error("Invalid recalled queue batch");
    await appendLocked(this.commandsPath(commands[0].targetSessionId), commands.map(command => JSON.stringify({ kind: "command", command })).join("\n"), commit);
  }

  async appendQueueMutation(commands: SessionCommandRecord[], commit: (persist: () => void) => void): Promise<void> {
    if (commands.length !== 1) throw new Error("Expected one queue mutation");
    await appendLocked(this.commandsPath(commands[0].targetSessionId), JSON.stringify({ kind: "command", command: commands[0] }), commit);
  }

  async appendCommand(command: SessionCommandRecord): Promise<void> {
    await appendLocked(this.commandsPath(command.targetSessionId), JSON.stringify({ kind: "command", command } satisfies CommandJournalEntry));
    try { recordAnalyticsCommand(command, command.acceptedAt); } catch { /* usage collection must not fail admission */ }
  }

  async appendStatus(command: SessionCommandRecord, status: SessionCommandStatus, patch: Partial<SessionCommandRecord> = {}): Promise<void> {
    const timestamp = Date.now();
    await appendLocked(this.commandsPath(command.targetSessionId), JSON.stringify({ kind: "status", commandId: command.commandId, status, patch, timestamp } satisfies CommandJournalEntry));
    try { recordAnalyticsCommand({ ...command, ...patch, status }, timestamp); } catch { /* durable journal will reconcile */ }
  }

  async appendEvent(event: Omit<SessionCommandEvent, "cursor">): Promise<SessionCommandEvent> {
    const path = this.eventsPath(event.sessionId);
    return serializeWrite(path, async () => {
      const directory = resolve(path, "..");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const release = await lockfile.lock(directory, {
        lockfilePath: `${path}.lock`,
        realpath: false,
        retries: { retries: 50, factor: 1.15, minTimeout: 4, maxTimeout: 50 },
      });
      try {
        const full: SessionCommandEvent = { ...event, cursor: readLastCursor(path) + 1 };
        const after = persistLines("events", path, JSON.stringify({ event: full } satisfies EventJournalEntry));
        saveCursor(path, fileRevision(after), full.cursor);
        return full;
      } finally {
        await release();
      }
    });
  }

  listEvents(sessionId: string, afterCursor = 0): SessionCommandEvent[] {
    return readJournalEvents(this.eventsPath(sessionId), afterCursor);
  }

  lastEventCursor(sessionId: string): number {
    return readLastCursor(this.eventsPath(sessionId));
  }

  /** Compact only old terminal commands; active commands remain recoverable. */
  async compact(sessionId: string, now = Date.now()): Promise<void> {
    const path = this.commandsPath(sessionId);
    await serializeWrite(path, async () => {
      const directory = resolve(path, "..");
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const release = await lockfile.lock(directory, {
        lockfilePath: `${path}.lock`,
        realpath: false,
        retries: { retries: 50, factor: 1.15, minTimeout: 4, maxTimeout: 50 },
      });
      try {
        const commands = this.loadCommands(sessionId);
        const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;
        const terminal = new Set<SessionCommandStatus>(["completed", "failed", "cancelled", "expired", "interrupted"]);
        // UI submissions are the durable recovery archive, including commands
        // stopped before the SDK wrote a user message. Never age them out.
        const retained = new Set(commands.filter((command) => command.source !== "ui" && (!terminal.has(command.status) || command.acceptedAt >= cutoff)).slice(-this.retentionCount));
        const keep = commands.filter((command) => command.source === "ui" || retained.has(command));
        if (keep.length === commands.length) return;
        const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(temporary, keep.map((command) => JSON.stringify({ kind: "command", command } satisfies CommandJournalEntry)).join("\n") + (keep.length ? "\n" : ""), { encoding: "utf8", mode: 0o600 });
        renameSync(temporary, path);
      } finally {
        await release();
      }
    });
  }
}

export function resetSessionControlStoreForTests(): void {
  resetSessionControlReadIndex();
  globalThis.__pioraSessionControlCursors?.clear();
  globalThis.__pioraSessionControlWriteLocks?.clear();
}
