import type { Stats } from "node:fs";
import { JsonlFileIndex, readJsonLine, type JsonLineSpan } from "./jsonl-file-index";
import type { SessionCommandEvent, SessionCommandRecord, SessionCommandStatus } from "./session-message-types";
import { latestTaskTiming, type TaskTiming } from "./task-timing";

export type CommandJournalEntry =
  | { kind: "command"; command: SessionCommandRecord }
  | { kind: "status"; commandId: string; status: SessionCommandStatus; patch?: Partial<SessionCommandRecord>; timestamp: number };
export type EventJournalEntry = { event: SessionCommandEvent };

const terminal = new Set<SessionCommandStatus>(["completed", "failed", "cancelled", "expired", "interrupted"]);
type CommandMetadata = Pick<SessionCommandRecord, "acceptedAt" | "idempotencyKey" | "inputMode" | "delivery" | "source" | "status" | "taskTiming">;
interface CommandLocation {
  base: JsonLineSpan;
  patches: JsonLineSpan[];
  metadata: CommandMetadata;
  slash: boolean;
  images: boolean;
  materials: boolean;
  operation: boolean;
  order: number;
}

function active(command: CommandLocation) { return !terminal.has(command.metadata.status); }
function uiOperation(command: CommandLocation) { return command.metadata.source === "ui" && command.operation; }

class CommandJournalIndex {
  readonly commands = new Map<string, CommandLocation>();
  readonly active = new Set<CommandLocation>();
  readonly slashReceipts = new Set<CommandLocation>();
  readonly byIdempotency = new Map<string, Set<CommandLocation>>();
  readonly operations: CommandLocation[] = [];
  readonly uiCommands = new Set<CommandLocation>();
  readonly timed = new Set<CommandLocation>();
  private latestTiming: TaskTiming | null | undefined;
  spanCount = 0;

  private order(command: CommandLocation) {
    return command.metadata.acceptedAt || 0;
  }

  private compare = (left: CommandLocation, right: CommandLocation) => this.order(left) - this.order(right) || left.order - right.order;

  private operationPosition(command: CommandLocation) {
    let low = 0, high = this.operations.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.compare(this.operations[middle], command) < 0) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private removeSelectors(command: CommandLocation): void {
    this.active.delete(command);
    this.slashReceipts.delete(command);
    this.uiCommands.delete(command);
    if (this.timed.delete(command)) this.latestTiming = undefined;
    const key = command.metadata.idempotencyKey;
    const matching = this.byIdempotency.get(key);
    matching?.delete(command);
    if (!matching?.size) this.byIdempotency.delete(key);
    if (uiOperation(command)) {
      const position = this.operationPosition(command);
      if (this.operations[position] === command) this.operations.splice(position, 1);
    }
  }

  private addSelectors(command: CommandLocation): void {
    const { idempotencyKey, source, status, inputMode, delivery } = command.metadata;
    if (!this.byIdempotency.has(idempotencyKey)) this.byIdempotency.set(idempotencyKey, new Set());
    this.byIdempotency.get(idempotencyKey)!.add(command);
    if (active(command)) this.active.add(command);
    if (source === "ui") {
      this.uiCommands.add(command);
      if (command.metadata.taskTiming) {
        this.timed.add(command);
        this.latestTiming = undefined;
      }
    }
    if (uiOperation(command)) this.operations.splice(this.operationPosition(command), 0, command);
    if (source === "ui" && status === "completed" && inputMode !== "text" && delivery === "next_turn"
      && command.slash && (command.operation || !command.images && !command.materials)) this.slashReceipts.add(command);
  }

  add(entry: CommandJournalEntry, span: JsonLineSpan): void {
    if (entry.kind === "command" && entry.command?.commandId) {
      const { commandId, acceptedAt, idempotencyKey, inputMode, delivery, source, status, taskTiming, content, operation, images, materials } = entry.command;
      const existing = this.commands.get(commandId);
      if (existing) {
        this.removeSelectors(existing);
        this.spanCount -= existing.patches.length + 1;
      }
      const command = { base: span, patches: [], order: existing?.order ?? this.commands.size,
        metadata: { acceptedAt, idempotencyKey, inputMode, delivery, source, status, taskTiming },
        slash: typeof content === "string" && content.trimStart().startsWith("/"),
        operation: Boolean(operation), images: Boolean(images?.length), materials: Boolean(materials?.length) };
      this.commands.set(commandId, command);
      this.spanCount++;
      this.addSelectors(command);
    } else if (entry.kind === "status" && entry.commandId) {
      const existing = this.commands.get(entry.commandId);
      if (!existing) return;
      this.removeSelectors(existing);
      const { patch } = entry;
      if (patch) {
        for (const key of ["acceptedAt", "idempotencyKey", "inputMode", "delivery", "source", "taskTiming"] as const) {
          if (key in patch) Object.assign(existing.metadata, { [key]: patch[key] });
        }
        if ("content" in patch) existing.slash = typeof patch.content === "string" && patch.content.trimStart().startsWith("/");
        if ("operation" in patch) existing.operation = Boolean(patch.operation);
        if ("images" in patch) existing.images = Boolean(patch.images?.length);
        if ("materials" in patch) existing.materials = Boolean(patch.materials?.length);
      }
      existing.metadata.status = entry.status;
      existing.patches.push(span);
      this.spanCount++;
      this.addSelectors(existing);
    }
  }

  sorted(commands: Iterable<CommandLocation> = this.commands.values()) {
    return [...commands].sort(this.compare);
  }

  byKey(key: string): CommandLocation | undefined {
    const matching = this.byIdempotency.get(key);
    return matching && this.sorted(matching)[0];
  }

  withKeys(keys: ReadonlySet<string>): Set<CommandLocation> {
    const matches = new Set<CommandLocation>();
    for (const key of keys) for (const command of this.byIdempotency.get(key) ?? []) matches.add(command);
    return matches;
  }

  getLatestTiming(): TaskTiming | null {
    if (this.latestTiming === undefined) {
      this.latestTiming = latestTaskTiming(this.sorted(this.timed).map(command => command.metadata));
    }
    return this.latestTiming;
  }

  readTimings(keys?: ReadonlySet<string>) {
    const selected = keys ? this.withKeys(keys) : this.timed;
    return this.sorted(selected).flatMap(command => {
      const { idempotencyKey, taskTiming } = command.metadata;
      return taskTiming && this.timed.has(command) ? [{ idempotencyKey, taskTiming }] : [];
    });
  }

  materialize(descriptor: number, locations: Iterable<CommandLocation>): SessionCommandRecord[] {
    const records: SessionCommandRecord[] = [];
    for (const location of locations) {
      const initial = readJsonLine<CommandJournalEntry>(descriptor, location.base);
      if (initial?.kind !== "command" || !initial.command) continue;
      const command = initial.command;
      for (const span of location.patches) {
        const record = readJsonLine<CommandJournalEntry>(descriptor, span);
        if (record?.kind === "status" && record.commandId === command.commandId) {
          Object.assign(command, record.patch, { status: record.status });
        }
      }
      records.push(command);
    }
    return records;
  }
}

interface EventLocation extends JsonLineSpan { cursor: number }

declare global {
  var __pioraCommandReadIndex: ReturnType<typeof createCommandIndex> | undefined;
  var __pioraEventReadIndex: ReturnType<typeof createEventIndex> | undefined;
}

function createCommandIndex() {
  return new JsonlFileIndex(() => new CommandJournalIndex(), (state, entry: CommandJournalEntry, span) => state.add(entry, span),
    state => state.spanCount + state.commands.size * 4);
}

function createEventIndex() {
  return new JsonlFileIndex((): { ordered: boolean; positions: EventLocation[] } => ({ ordered: true, positions: [] }), (state, entry: EventJournalEntry, span) => {
    if (typeof entry.event?.cursor !== "number") return;
    if (entry.event.cursor <= (state.positions.at(-1)?.cursor ?? -1)) state.ordered = false;
    state.positions.push({ ...span, cursor: entry.event.cursor });
  }, state => state.positions.length);
}

function commandIndex() { return globalThis.__pioraCommandReadIndex ??= createCommandIndex(); }
function eventIndex() { return globalThis.__pioraEventReadIndex ??= createEventIndex(); }

export function readAllCommands(file: string): SessionCommandRecord[] {
  return commandIndex().query(file, (state, descriptor) => state.materialize(descriptor, state.sorted())) ?? [];
}

export async function readActiveCommands(file: string): Promise<SessionCommandRecord[]> {
  return await commandIndex().queryAsync(file, (state, descriptor) => state.materialize(descriptor, state.sorted(state.active))) ?? [];
}

function slashReceipts(state: CommandJournalIndex, keys?: ReadonlySet<string>): string[] {
  if (!keys) return state.sorted(state.slashReceipts).map(command => command.metadata.idempotencyKey);
  return [...keys].filter(key => {
    for (const command of state.byIdempotency.get(key) ?? []) {
      if (state.slashReceipts.has(command)) return true;
    }
    return false;
  });
}

export function readSlashReceipts(file: string, keys?: ReadonlySet<string>): string[] {
  return commandIndex().query(file, state => slashReceipts(state, keys)) ?? [];
}

export async function querySlashReceipts(file: string, keys?: ReadonlySet<string>): Promise<string[]> {
  if (keys?.size === 0) return [];
  return await commandIndex().queryAsync(file, state => slashReceipts(state, keys)) ?? [];
}

export function findJournalCommand(file: string, query: { commandId: string } | { idempotencyKey: string }): SessionCommandRecord | undefined {
  return commandIndex().query(file, (state, descriptor) => {
    const match = "commandId" in query ? state.commands.get(query.commandId) : state.byKey(query.idempotencyKey);
    return match && state.materialize(descriptor, [match])[0];
  });
}

export function queryCommandByKey(file: string, key: string): Promise<SessionCommandRecord | undefined> {
  return commandIndex().queryAsync(file, (state, descriptor) => {
    const match = state.byKey(key);
    return match && state.materialize(descriptor, [match])[0];
  });
}

export function queryCommandById(file: string, commandId: string): Promise<SessionCommandRecord | undefined> {
  return commandIndex().queryAsync(file, (state, descriptor) => {
    const match = state.commands.get(commandId);
    return match && state.materialize(descriptor, [match])[0];
  });
}

export interface CommandPageOptions {
  offset: number;
  trackedIds: ReadonlySet<string>;
  recoveredKeys: ReadonlySet<string>;
  timingKeys?: ReadonlySet<string>;
}

export async function readOperationsPage(file: string, { offset, trackedIds, recoveredKeys, timingKeys }: CommandPageOptions) {
  return commandIndex().queryAsync(file, (state, descriptor) => {
    const end = Math.max(0, state.operations.length - offset);
    const selected = new Set(state.operations.slice(Math.max(0, end - 50), end).reverse());
    const extras = state.withKeys(recoveredKeys);
    for (const location of state.active) extras.add(location);
    for (const id of trackedIds) {
      const location = state.commands.get(id);
      if (location) extras.add(location);
    }
    for (const command of state.sorted(extras)) if (state.uiCommands.has(command)) selected.add(command);
    return {
      hasUiRecords: state.uiCommands.size !== 0,
      commands: state.materialize(descriptor, selected),
      taskTiming: state.getLatestTiming(),
      taskTimings: state.readTimings(timingKeys),
      nextOffset: end > 50 ? offset + 50 : null,
    };
  });
}

export function readArchivePage(file: string, offset: number) {
  return commandIndex().queryAsync(file, (state, descriptor) => {
    const end = Math.max(0, state.uiCommands.size - offset);
    const latest = state.sorted(state.uiCommands).slice(Math.max(0, end - 50), end).reverse();
    return { hasUiRecords: state.uiCommands.size !== 0, commands: state.materialize(descriptor, latest), nextOffset: end > 50 ? offset + 50 : null };
  });
}

export function readTaskTimings(file: string, keys: ReadonlySet<string>) {
  return commandIndex().queryAsync(file, state => state.readTimings(keys));
}

export async function readOperationWindow(file: string, limit: number) {
  return await commandIndex().queryAsync(file, (state, descriptor) => {
    const waiting = [...state.active].filter(command => command.metadata.source === "ui");
    const selected = new Set([...state.operations.slice(-limit), ...waiting]);
    const ordered = state.sorted(selected);
    return { commands: state.materialize(descriptor, ordered),
      hasMore: state.operations.length + waiting.filter(command => !command.operation).length > limit };
  }) ?? { commands: [], hasMore: false };
}

export function readJournalEvents(file: string, afterCursor: number): SessionCommandEvent[] {
  return eventIndex().query(file, ({ ordered, positions }, descriptor) => {
    let low = 0, high = ordered ? positions.length : 0;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (positions[middle].cursor <= afterCursor) low = middle + 1;
      else high = middle;
    }
    const events: SessionCommandEvent[] = [];
    for (let index = low; index < positions.length; index++) {
      if (positions[index].cursor <= afterCursor) continue;
      const event = readJsonLine<EventJournalEntry>(descriptor, positions[index])?.event;
      if (event && event.cursor > afterCursor) events.push(event);
    }
    return events;
  }) ?? [];
}

export function resetSessionControlReadIndex(): void {
  commandIndex().clear();
  eventIndex().clear();
}

export function indexJournalAppend(kind: "commands" | "events", file: string, before: Stats | undefined, after: Stats, bytes: Buffer, aligned: boolean): void {
  const index = kind === "commands" ? commandIndex() : eventIndex();
  try { index.appended(file, before, after, bytes, aligned); }
  catch (error) {
    index.forget(file);
    console.warn("[pi-web] local command index discarded after append", error instanceof Error ? error.name : "unknown error");
  }
}
