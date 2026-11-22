import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { getRuntimeAgentDataDirectory } from "./runtime-home";
import { summarizeToolActivity } from "./subagents/activity-format";
import {
  isSubagentId,
  truncatedSubagentResultPrefix,
  type SubagentRecord,
  type SubagentTranscriptEntry,
  type SubagentTranscriptPage,
} from "./subagent-types";

const CHUNK = 32 * 1024;
const SCAN_LIMIT = 2 * 1024 * 1024;
const LINE_LIMIT = 128 * 1024;
const PAGE_LIMIT = 96 * 1024;
const ENTRY_LIMIT = 50;
type Handle = Awaited<ReturnType<typeof open>>;
type Cursor = { identity: string; offset: number; size: number; changed: string; boundary: string; skipping: boolean; within?: number };

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
      && typeof parsed.skipping === "boolean"
      && (parsed.within === undefined || (Number.isSafeInteger(parsed.within) && parsed.within > 0))) return parsed;
  } catch { /* Invalid cursors never select a transcript. */ }
  throw new TypeError("Invalid transcript cursor");
}

interface ExtractedToolCall {
  name: string;
  summary?: string;
  toolCallId?: string;
}

function parseMessageRecord(buffer: Buffer, endedAt?: number) {
  let entry;
  try { entry = JSON.parse(buffer.toString("utf8")); } catch { return null; }
  const message = entry?.message;
  if (entry?.type !== "message" || !["user", "assistant", "toolResult"].includes(message?.role)) return null;
  if (endedAt !== undefined && typeof entry.timestamp === "string" && Date.parse(entry.timestamp) > endedAt) return null;
  const blocks: unknown[] = Array.isArray(message.content) ? message.content : [];
  const texts: string[] = typeof message.content === "string" ? [message.content] : [];
  const toolCalls: ExtractedToolCall[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const data = block as { type?: unknown; text?: unknown; name?: unknown; toolName?: unknown; id?: unknown; toolCallId?: unknown; arguments?: unknown; input?: unknown };
    if (data.type === "text" && typeof data.text === "string") texts.push(data.text);
    const name = data.name ?? data.toolName;
    if (data.type === "toolCall" && typeof name === "string") {
      const clean = name.slice(0, 80);
      const rawId = data.id ?? data.toolCallId;
      toolCalls.push({
        name: clean,
        summary: summarizeToolActivity(clean, data.arguments ?? data.input),
        toolCallId: typeof rawId === "string" && rawId ? rawId.slice(0, 128) : undefined,
      });
    }
  }
  const timestamp = typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
    ? message.timestamp
    : typeof entry.timestamp === "string" && Number.isFinite(Date.parse(entry.timestamp))
      ? Date.parse(entry.timestamp)
      : undefined;
  return { entry, message, text: texts.join("\n"), toolCalls, timestamp };
}

function visibleEntries(buffer: Buffer, offset: number, textLimit = 8_000, endedAt?: number): SubagentTranscriptEntry[] {
  const parsed = parseMessageRecord(buffer, endedAt);
  if (!parsed) return [];
  const { entry, message, text, toolCalls, timestamp } = parsed;
  const baseId = typeof entry.id === "string" && entry.id.length <= 128 ? entry.id : String(offset);

  if (message.role === "assistant") {
    if (!text && toolCalls.length === 0) return [];
    const results: SubagentTranscriptEntry[] = [];
    if (text) {
      results.push({
        id: baseId,
        role: "assistant",
        text: text.slice(0, textLimit),
        ...(timestamp !== undefined ? { timestamp } : {}),
        truncated: text.length > textLimit || undefined,
      });
    }
    if (toolCalls.length === 1 && !text) {
      const call = toolCalls[0];
      results.push({
        id: baseId,
        role: "toolCall",
        text: "",
        toolName: call.name,
        ...(call.summary ? { toolSummary: call.summary } : {}),
        ...(call.toolCallId ? { toolCallId: call.toolCallId } : {}),
        ...(timestamp !== undefined ? { timestamp } : {}),
      });
    } else if (toolCalls.length > 0) {
      for (let index = 0; index < toolCalls.length; index++) {
        const call = toolCalls[index];
        results.push({
          id: `${baseId}:tool:${index}`,
          role: "toolCall",
          text: "",
          toolName: call.name,
          ...(call.summary ? { toolSummary: call.summary } : {}),
          ...(call.toolCallId ? { toolCallId: call.toolCallId } : {}),
          ...(timestamp !== undefined ? { timestamp } : {}),
        });
      }
    }
    return results;
  }

  const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId.slice(0, 128) : undefined;
  const toolName = typeof message.toolName === "string" ? message.toolName.slice(0, 180) : undefined;
  return [{
    id: baseId,
    role: message.role,
    text: text.slice(0, textLimit),
    ...(toolName ? { toolName } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(message.role === "toolResult" && message.isError === true ? { isError: true } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    truncated: text.length > textLimit || undefined,
  }];
}

async function readTranscriptSnapshot<T>(
  record: SubagentRecord,
  signal: AbortSignal,
  readSnapshot: (file: Handle, initial: Stats) => Promise<T>,
): Promise<T | undefined> {
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
    let moreWithin: number | undefined;
    let resumeWithin = cursor?.within;
    const consume = async (lineStart: number) => {
      const length = lineEnd - lineStart;
      if (skipping || length === 0) {
        resumeWithin = undefined;
        return true;
      }
      const fullBatch: SubagentTranscriptEntry[] = length > LINE_LIMIT
        ? [{ id: `omitted:${lineEnd}`, role: "omitted", text: "" }]
        : visibleEntries(await read(file, lineStart, length), lineStart);
      const limit = resumeWithin !== undefined ? Math.min(resumeWithin, fullBatch.length) : fullBatch.length;
      resumeWithin = undefined;
      if (limit === 0) return true;
      for (let i = limit - 1; i >= 0; i--) {
        if (entries.length >= ENTRY_LIMIT) {
          moreWithin = i === fullBatch.length - 1 ? undefined : i + 1;
          return false;
        }
        let item = fullBatch[i];
        let itemSize = Buffer.byteLength(JSON.stringify(item)) + 1;
        if (itemSize > PAGE_LIMIT - 2) {
          item = { id: `omitted:${lineEnd}:${i}`, role: "omitted", text: "" };
          itemSize = Buffer.byteLength(JSON.stringify(item)) + 1;
        }
        if (bytes + itemSize > PAGE_LIMIT) {
          if (entries.length > 0) {
            moreWithin = i === fullBatch.length - 1 ? undefined : i + 1;
            return false;
          }
          // Single item fits PAGE_LIMIT - 2 because oversized items were replaced above.
        }
        entries.push(item);
        bytes += itemSize;
      }
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
    const next: Cursor | null = moreAt ? {
      identity,
      offset: moreAt,
      size: initial.size,
      changed,
      boundary: await boundary(file, moreAt),
      skipping: moreSkipping,
      ...(moreWithin !== undefined ? { within: moreWithin } : {}),
    } : null;
    return { entries: entries.reverse(), before: next ? Buffer.from(JSON.stringify(next)).toString("base64url") : null };
  });
  if (!page && before) throw new StaleSubagentTranscript("Transcript is no longer available");
  return page ?? empty;
}

export async function readSubagentResult(record: SubagentRecord, signal: AbortSignal): Promise<string | null> {
  const suffixPrefix = truncatedSubagentResultPrefix(record.result);
  const needsRecovery = record.resultTruncated === true || suffixPrefix !== undefined;
  if (!needsRecovery) return record.result;
  return await readTranscriptSnapshot(record, signal, async (file, initial) => {
    const offset = Math.max(0, initial.size - SCAN_LIMIT);
    const tail = await read(file, offset, initial.size - offset);
    const attemptStart = record.attemptStartedAt ?? record.startedAt;
    // Scan only the latest completed turn (never cross a prior attempt's user message).
    for (let end = tail.lastIndexOf(10); end > 0;) {
      signal.throwIfAborted();
      const start = tail.lastIndexOf(10, end - 1) + 1;
      if (!start && offset > 0) break;
      const parsed = parseMessageRecord(tail.subarray(start, end), record.endedAt);
      if (parsed?.message.role === "user") break;
      if (parsed?.message.role === "assistant") {
        if (record.resultEntryId) {
          if (parsed.entry.id === record.resultEntryId) return parsed.text;
        } else {
          const withinAttemptWindow = parsed.timestamp === undefined || attemptStart === undefined || parsed.timestamp >= attemptStart;
          const lengthMatches = record.resultFullLength !== undefined
            ? parsed.text.length === record.resultFullLength
            : parsed.text.length > record.result.length;
          const prefixMatches = suffixPrefix === undefined || parsed.text.startsWith(suffixPrefix);
          if (withinAttemptWindow && lengthMatches && prefixMatches) {
            return parsed.text;
          }
        }
      }
      end = start - 1;
    }
    return null;
  }) ?? null;
}
