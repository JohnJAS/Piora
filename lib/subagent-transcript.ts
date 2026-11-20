import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { getRuntimeAgentDataDirectory } from "./runtime-home";
import { isSubagentId, truncatedSubagentResultPrefix, type SubagentRecord, type SubagentTranscriptEntry, type SubagentTranscriptPage } from "./subagent-types";

const CHUNK = 32 * 1024;
const SCAN_LIMIT = 2 * 1024 * 1024;
const LINE_LIMIT = 128 * 1024;
const PAGE_LIMIT = 96 * 1024;
const ENTRY_LIMIT = 50;
type Handle = Awaited<ReturnType<typeof open>>;
type Cursor = { identity: string; offset: number; size: number; changed: string; boundary: string; skipping: boolean };

export class StaleSubagentTranscript extends Error {}

function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function fileIdentity(value: Stats): string {
  return [value.dev, value.ino, value.birthtimeMs].join(":");
}

async function read(file: Handle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length);
  let used = 0;
  while (used < length) {
    const { bytesRead } = await file.read(buffer, used, length - used, offset + used);
    if (bytesRead === 0) throw new StaleSubagentTranscript("Transcript changed; reload its latest page");
    used += bytesRead;
  }
  return buffer;
}

async function boundary(file: Handle, offset: number): Promise<string> {
  const length = Math.min(offset, 512);
  return createHash("sha256").update(await read(file, offset - length, length)).digest("base64url");
}

function parseCursor(value: string): Cursor {
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) throw new TypeError("Invalid transcript cursor");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (typeof parsed.identity === "string" && typeof parsed.changed === "string" && typeof parsed.boundary === "string"
      && Number.isSafeInteger(parsed.offset) && parsed.offset > 0 && Number.isSafeInteger(parsed.size) && parsed.size >= parsed.offset
      && typeof parsed.skipping === "boolean") return parsed;
  } catch { /* Invalid cursors never select a transcript. */ }
  throw new TypeError("Invalid transcript cursor");
}

function visibleEntry(buffer: Buffer, offset: number, textLimit = 8_000, endedAt?: number): SubagentTranscriptEntry | null {
  let entry;
  try { entry = JSON.parse(buffer.toString("utf8")); } catch { return null; }
  const message = entry?.message;
  if (entry?.type !== "message" || !["user", "assistant", "toolResult"].includes(message?.role)) return null;
  if (endedAt !== undefined && typeof entry.timestamp === "string" && Date.parse(entry.timestamp) > endedAt) return null;
  const blocks: unknown[] = Array.isArray(message.content) ? message.content : [];
  const texts: string[] = typeof message.content === "string" ? [message.content] : [];
  const tools: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const data = block as { type?: unknown; text?: unknown; name?: unknown; toolName?: unknown };
    if (data.type === "text" && typeof data.text === "string") texts.push(data.text);
    const name = data.name ?? data.toolName;
    if (data.type === "toolCall" && typeof name === "string") tools.push(name.slice(0, 80));
  }
  const text = texts.join("\n");
  if (!text && !tools.length && message.role === "assistant") return null;
  return {
    id: typeof entry.id === "string" && entry.id.length <= 128 ? entry.id : String(offset),
    role: !text && tools.length > 0 ? "toolCall" : message.role,
    text: text.slice(0, textLimit),
    toolName: (tools.join(", ") || (typeof message.toolName === "string" ? message.toolName : "")).slice(0, 180) || undefined,
    truncated: text.length > textLimit || undefined,
  };
}

async function readTranscriptSnapshot<T>(record: SubagentRecord, signal: AbortSignal,
  readSnapshot: (file: Handle, initial: Stats) => Promise<T>): Promise<T | undefined> {
  if (!record.childSessionFile) return;
  if (!isSubagentId(record.parentSessionId) || !isSubagentId(record.agentId)) throw new TypeError("Invalid transcript identity");
  try {
    const root = await realpath(join(getRuntimeAgentDataDirectory(), "piora"));
    const configured = join(root, "subagent-sessions", record.parentSessionId, record.agentId);
    const directory = await realpath(configured);
    const path = await realpath(record.childSessionFile);
    if (relative(configured, directory) !== "" || !within(directory, path) || relative(directory, path).includes(sep)
      || !(await lstat(record.childSessionFile)).isFile()) throw new Error("Invalid subagent transcript location");
    const file = await open(path, "r");
    try {
      signal.throwIfAborted();
      const initial = await file.stat();
      if (!initial.isFile() || fileIdentity(await stat(path)) !== fileIdentity(initial)) throw new StaleSubagentTranscript("Transcript was replaced");
      const result = await readSnapshot(file, initial);
      const current = await file.stat();
      if (current.size < initial.size || (current.size === initial.size && (current.mtimeMs !== initial.mtimeMs || current.ctimeMs !== initial.ctimeMs))
        || fileIdentity(await stat(path)) !== fileIdentity(initial)) throw new StaleSubagentTranscript("Transcript changed; reload its latest page");
      return result;
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export async function readSubagentTranscript(record: SubagentRecord, before: string | null, signal: AbortSignal): Promise<SubagentTranscriptPage> {
  const empty = { entries: [], before: null };
  if (!record.childSessionFile) return empty;
  const page = await readTranscriptSnapshot(record, signal, async (file, initial) => {
    if (!initial.size) return empty;
    const identity = createHash("sha256").update(JSON.stringify([record.parentSessionId, record.agentId, record.attempt ?? 1, fileIdentity(initial)])).digest("base64url");
    const changed = `${initial.mtimeMs}:${initial.ctimeMs}`;
    const cursor = before ? parseCursor(before) : null;
    if (cursor && (cursor.identity !== identity || initial.size < cursor.size || (initial.size === cursor.size && cursor.changed !== changed)
      || await boundary(file, cursor.offset) !== cursor.boundary)) throw new StaleSubagentTranscript("Transcript changed; reload its latest page");

    const start = cursor?.offset ?? initial.size;
    let lineEnd = start;
    let skipping = cursor?.skipping ?? (await read(file, start - 1, 1))[0] !== 10;
    if (!cursor && !skipping) lineEnd--;
    let position = lineEnd;
    const floor = Math.max(0, start - SCAN_LIMIT);
    const entries: SubagentTranscriptEntry[] = [];
    let bytes = 2;
    let moreAt = 0;
    let moreSkipping = false;
    const consume = async (lineStart: number) => {
      const length = lineEnd - lineStart;
      if (skipping || length === 0) return true;
      const entry = length > LINE_LIMIT ? { id: `omitted:${lineEnd}`, role: "omitted" as const, text: "" }
        : visibleEntry(await read(file, lineStart, length), lineStart);
      if (!entry) return true;
      const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
      if (bytes + size > PAGE_LIMIT) return false;
      entries.push(entry);
      bytes += size;
      return true;
    };
    scan: while (position > floor) {
      signal.throwIfAborted();
      const beginning = Math.max(floor, position - CHUNK);
      const chunk = await read(file, beginning, position - beginning);
      for (let newline = chunk.lastIndexOf(10); newline >= 0; newline = newline > 0 ? chunk.lastIndexOf(10, newline - 1) : -1) {
        const offset = beginning + newline;
        if (!await consume(offset + 1)) { moreAt = lineEnd; break scan; }
        lineEnd = offset;
        skipping = false;
        if (entries.length >= ENTRY_LIMIT) { moreAt = offset; break scan; }
      }
      position = beginning;
    }
    if (!moreAt && position === 0 && !await consume(0)) moreAt = lineEnd;
    if (!moreAt && floor > 0 && position === floor) {
      if (!skipping && lineEnd - floor >= LINE_LIMIT) entries.push({ id: `omitted:${lineEnd}`, role: "omitted", text: "" });
      moreAt = floor;
      moreSkipping = floor !== lineEnd;
    }
    const next: Cursor | null = moreAt ? { identity, offset: moreAt, size: initial.size, changed, boundary: await boundary(file, moreAt), skipping: moreSkipping } : null;
    return { entries: entries.reverse(), before: next ? Buffer.from(JSON.stringify(next)).toString("base64url") : null };
  });
  if (!page && before) throw new StaleSubagentTranscript("Transcript is no longer available");
  return page ?? empty;
}

export async function readSubagentResult(record: SubagentRecord, signal: AbortSignal): Promise<string | null> {
  const prefix = truncatedSubagentResultPrefix(record.result);
  if (prefix === undefined) return record.result;
  return await readTranscriptSnapshot(record, signal, async (file, initial) => {
    const offset = Math.max(0, initial.size - SCAN_LIMIT);
    const tail = await read(file, offset, initial.size - offset);
    // Only match complete assistant replies to the saved result prefix.
    for (let end = tail.lastIndexOf(10); end > 0;) {
      signal.throwIfAborted();
      const start = tail.lastIndexOf(10, end - 1) + 1;
      if (!start && offset > 0) break;
      const entry = visibleEntry(tail.subarray(start, end), offset + start, Infinity, record.endedAt);
      if (entry?.role === "assistant" && entry.text.length > record.result.length && entry.text.startsWith(prefix)) return entry.text;
      end = start - 1;
    }
    return null;
  }) ?? null;
}
