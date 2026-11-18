import { closeSync, fstatSync, openSync, readSync, statSync, type Stats } from "node:fs";
import { open, stat, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

export interface JsonLineSpan {
  offset: number;
  length: number;
}

const SCAN_CHUNK = 64 * 1024;

export function fileRevision(stat: Stats): string {
  return [stat.dev, stat.ino, stat.birthtimeMs, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
}

export function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
}

function readRange(descriptor: number, offset: number, length: number): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  let total = 0;
  while (total < length) {
    const read = readSync(descriptor, buffer, total, length - total, offset + total);
    if (!read) break;
    total += read;
  }
  return buffer.subarray(0, total);
}

function parseJson<T>(line: Buffer): T | undefined {
  try { return JSON.parse(line.toString("utf8")) ?? undefined; }
  catch { return undefined; }
}

function requireJournalDirectory(parent: Stats | undefined): void {
  if (parent && !parent.isDirectory()) throw new Error("Local journal parent is not a directory");
}

export function readJsonLine<T>(descriptor: number, { offset, length }: JsonLineSpan): T | undefined {
  return parseJson<T>(readRange(descriptor, offset, length));
}

export function endsInNewline(descriptor: number, size: number): boolean {
  return size === 0 || readRange(descriptor, size - 1, 1)[0] === 10;
}

interface JsonlState<T> {
  revision: string;
  value: T;
  weight: number;
}

function lineScanner<T>(add: (entry: T, span: JsonLineSpan) => void) {
  let lineStart = 0;
  let partial: Buffer[] = [];
  const emit = (end: number) => {
    const value = parseJson<T>(partial.length === 1 ? partial[0] : Buffer.concat(partial));
    if (value !== undefined) add(value, { offset: lineStart, length: end - lineStart });
    partial = [];
  };
  return {
    consume(chunk: Buffer, offset: number) {
      let start = 0;
      for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
        partial.push(chunk.subarray(start, end));
        emit(offset + end);
        start = end + 1;
        lineStart = offset + start;
      }
      if (start < chunk.length) partial.push(chunk.subarray(start));
    },
    finish(size: number) {
      if (!partial.length) return true;
      emit(size);
      return false;
    },
  };
}

export function lastJsonLine<T, Result>(
  descriptor: number,
  size: number,
  select: (value: T) => Result | undefined,
): Result | undefined {
  let partial: Buffer[] = [];
  const selected = () => {
    const value = parseJson<T>(partial.length === 1 ? partial[0] : Buffer.concat([...partial].reverse()));
    partial = [];
    return value === undefined ? undefined : select(value);
  };
  while (size > 0) {
    const offset = Math.max(0, size - SCAN_CHUNK);
    const chunk = readRange(descriptor, offset, size - offset);
    let end = chunk.length;
    let divider = chunk.lastIndexOf(10, end - 1);
    while (divider !== -1) {
      partial.push(chunk.subarray(divider + 1, end));
      const value = selected();
      if (value !== undefined) return value;
      end = divider;
      divider = end > 0 ? chunk.lastIndexOf(10, end - 1) : -1;
    }
    if (end) partial.push(chunk.subarray(0, end));
    size = offset;
  }
  return selected();
}

export class JsonlFileIndex<Entry, State> {
  private readonly cache = new Map<string, JsonlState<State>>();
  private readonly builds = new Map<string, { revision: string; result: Promise<State | undefined> }>();
  private weight = 0;
  constructor(
    private readonly create: () => State,
    private readonly apply: (state: State, entry: Entry, span: JsonLineSpan) => void,
    private readonly cost: (state: State) => number,
    private readonly maxWeight = 400_000,
  ) {}

  forget(file: string): void {
    this.weight -= this.cache.get(file)?.weight ?? 0;
    this.cache.delete(file);
  }

  clear(): void {
    this.weight = 0;
    this.cache.clear();
    this.builds.clear();
  }

  private remember(file: string, snapshot: Stats, value: State): void {
    this.forget(file);
    const weight = this.cost(value) + 1;
    if (weight > this.maxWeight) return;
    this.cache.set(file, { value, weight, revision: fileRevision(snapshot) });
    this.weight += weight;
    while (this.cache.size > 128 || this.weight > this.maxWeight) {
      this.forget(this.cache.keys().next().value!);
    }
  }

  appended(file: string, before: Stats | undefined, after: Stats, bytes: Buffer, aligned: boolean): void {
    const cached = this.cache.get(file);
    if ((before && (!cached || cached.revision !== fileRevision(before) || !sameFile(before, after)))
      || !aligned || after.size !== (before?.size ?? 0) + bytes.length) {
      this.forget(file);
      return;
    }
    const value = before && cached ? cached.value : this.create();
    const initialSize = before?.size ?? 0;
    let start = 0;
    for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
      const entry = parseJson<Entry>(bytes.subarray(start, end));
      if (entry !== undefined) this.apply(value, entry, { offset: initialSize + start, length: end - start });
      start = end + 1;
    }
    this.remember(file, after, value);
  }

  private cached(file: string, revision: string): JsonlState<State> | undefined {
    const previous = this.cache.get(file);
    if (previous?.revision !== revision) return undefined;
    this.cache.delete(file);
    this.cache.set(file, previous);
    return previous;
  }

  private async scan(file: string, handle: FileHandle, snapshot: Stats): Promise<State | undefined> {
    const revision = fileRevision(snapshot);
    const value = this.create();
    const scanner = lineScanner<Entry>((entry, span) => this.apply(value, entry, span));
    let offset = 0;
    while (offset < snapshot.size) {
      const chunk = Buffer.allocUnsafe(Math.min(SCAN_CHUNK, snapshot.size - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (!bytesRead) return undefined;
      scanner.consume(chunk.subarray(0, bytesRead), offset);
      offset += bytesRead;
    }
    const aligned = scanner.finish(offset);
    const observed = await stat(file).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
    if (!observed || fileRevision(observed) !== revision) return undefined;
    if (aligned && this.builds.get(file)?.revision === revision) this.remember(file, snapshot, value);
    return value;
  }

  async queryAsync<Result>(file: string, select: (state: State, descriptor: number) => Result): Promise<Result | undefined> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let handle: FileHandle;
      try { handle = await open(file, "r"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = await stat(dirname(file)).catch(failure => {
          if ((failure as NodeJS.ErrnoException).code === "ENOENT") return undefined;
          throw failure;
        });
        requireJournalDirectory(parent);
        return undefined;
      }
      try {
        const snapshot = await handle.stat();
        const revision = fileRevision(snapshot);
        const cached = this.cached(file, revision);
        if (cached) return select(cached.value, handle.fd);
        let build = this.builds.get(file);
        if (build?.revision !== revision) {
          build = { revision, result: this.scan(file, handle, snapshot) };
          this.builds.set(file, build);
        }
        try {
          const value = await build.result;
          if (value !== undefined) return select(value, handle.fd);
        } finally {
          if (this.builds.get(file) === build) this.builds.delete(file);
        }
      } finally {
        await handle.close();
      }
    }
    return this.query(file, select);
  }

  query<Result>(file: string, select: (state: State, descriptor: number) => Result): Result | undefined {
    const observed = statSync(file, { throwIfNoEntry: false });
    if (!observed) {
      this.forget(file);
      requireJournalDirectory(statSync(dirname(file), { throwIfNoEntry: false }));
      return undefined;
    }
    let descriptor: number;
    try { descriptor = openSync(file, "r"); }
    catch (error) {
      this.forget(file);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const snapshot = fstatSync(descriptor);
      const revision = fileRevision(snapshot);
      const previous = this.cached(file, revision);
      if (previous) return select(previous.value, descriptor);
      this.forget(file);
      const value = this.create();
      const scanner = lineScanner<Entry>((entry, span) => this.apply(value, entry, span));
      let offset = 0;
      while (offset < snapshot.size) {
        const chunk = readRange(descriptor, offset, Math.min(SCAN_CHUNK, snapshot.size - offset));
        if (!chunk.length) break;
        scanner.consume(chunk, offset);
        offset += chunk.length;
      }
      if (scanner.finish(offset) && offset === snapshot.size && fileRevision(fstatSync(descriptor)) === revision) {
        this.remember(file, snapshot, value);
      }
      return select(value, descriptor);
    } finally {
      closeSync(descriptor);
    }
  }
}
