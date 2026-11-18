import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { fileRevision } from "./jsonl-file-index";
import { stat } from "node:fs/promises";
import { readInWorker } from "./read-worker";
import { buildSessionContext, entryToUiMessage } from "./session-reader";
import { persistedMessagePromptIds } from "./session-message-delete";
import { readLatestSessionSystemPromptBinding, summarizeSessionSystemPromptBinding } from "./session-system-prompt";
import { summarizeSessionStats } from "./session-stats";
import type { SessionStatsInfo } from "./pi-types";
import type { AgentMessage, SessionContext, SessionEntry, SessionHeader } from "./types";
import type { SessionSystemPromptBinding } from "./system-prompt-types";

export const HISTORY_PAGE_BYTES = 256 * 1024;
export const HISTORY_PAGE_TURNS = 40;

export interface SessionHistoryCursor {
  generation: string;
  leafId: string;
  before: string;
}

export interface SessionHistoryPage {
  older: string | null;
  contextVersion: string;
  oversized: Array<{ id: string; anchors: string[] }>;
  focused?: boolean;
}

interface PageOptions {
  cursor?: SessionHistoryCursor;
  leafId?: string;
  around?: string;
  signal?: AbortSignal;
}

type WorkerPage =
  | { stale: true }
  | { missingAnchor: true }
  | { unsupported: true }
  | {
    generation: string;
    contextVersion: string;
    leafId: string | null;
    header: SessionHeader;
    name?: string;
    before: string | null;
    model: SessionContext["model"];
    thinkingLevel: string;
    modelChanges: SessionContext["modelChanges"];
    promptBinding?: SessionSystemPromptBinding;
    entries: Array<SessionEntry | { type: "oversize"; id: string }>;
    oversize: SessionHistoryPage["oversized"];
    previews: Array<{ id: string; messages: Array<{ id: string; text: string; timestamp?: number }> }>;
  };

export class SessionHistoryPageError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function encodeHistoryCursor(cursor: SessionHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeHistoryCursor(text: string | null): SessionHistoryCursor | undefined {
  if (text === null) return undefined;
  if (text.length > 512) throw new SessionHistoryPageError(400, "Invalid history cursor");
  try {
    const value = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    if (typeof value.generation === "string" && /^[a-f0-9]{64}$/.test(value.generation)
      && typeof value.leafId === "string" && value.leafId.length <= 128
      && typeof value.before === "string" && value.before.length <= 128) return value;
  } catch {}
  throw new SessionHistoryPageError(400, "Invalid history cursor");
}

export function readHistoryAnchor(query: URLSearchParams, name: "leafId" | "around"): string | undefined {
  const value = query.get(name);
  if (value !== null && (!value || value.length > 128)) throw new SessionHistoryPageError(400, "Invalid history anchor");
  return value ?? undefined;
}

function isDeletedUser(entry: SessionEntry): boolean {
  if (entry.type !== "custom" || entry.customType !== "piora-deleted-message") return false;
  const data = entry.data as { deletedUser?: unknown; role?: unknown; clientPromptId?: unknown } | undefined;
  return data?.deletedUser === true || data?.role === "user" || typeof data?.clientPromptId === "string";
}

function previewMessage(message: AgentMessage | undefined): string {
  if (message?.role !== "user") return "";
  const text = typeof message.content === "string" ? message.content
    : Array.isArray(message.content) ? message.content.find(block => block.type === "text")?.text ?? "" : "";
  return text.slice(0, 300);
}

function sessionInfo(header: SessionHeader, name: string | undefined, modified: string, count: number, firstMessage: string, path: string) {
  return { path, id: header.id, cwd: header.cwd ?? "", name, created: header.timestamp, modified, messageCount: count, firstMessage };
}

function cursorFor(generation: string, leafId: string | null, before: string | null) {
  return before && leafId && before.length <= 128 && leafId.length <= 128 ? encodeHistoryCursor({ generation, leafId, before }) : null;
}

function oversizedMessage(preview = ""): AgentMessage {
  return { role: "custom", customType: "history-oversized-turn", content: preview, display: true };
}

async function legacyPage(path: string, modified: string, options: PageOptions) {
  const manager = SessionManager.open(path);
  const header = manager.getHeader() as SessionHeader | null;
  const leafId = options.cursor?.leafId ?? options.leafId ?? manager.getLeafId();
  const generation = createHash("sha256").update(fileRevision(await stat(path))).digest("hex");
  if (options.cursor && options.cursor.generation !== generation) throw new SessionHistoryPageError(409, "History changed; refresh the conversation");
  const entries = manager.getEntries() as unknown as SessionEntry[];
  if (leafId && !entries.some(entry => entry.id === leafId)) throw new SessionHistoryPageError(404, "History branch not found");
  const full = buildSessionContext(entries, leafId, { deferThinking: true, deferToolResultImages: true });
  const before = options.cursor && full.entryIds.indexOf(options.cursor.before);
  const focus = options.around && full.entryIds.indexOf(options.around);
  if (before === -1 || focus === -1) throw new SessionHistoryPageError(404, "History entry not found");
  let end = before ?? full.entryIds.length;
  if (typeof focus === "number") {
    end = focus + 1;
    while (end < full.messages.length && full.messages[end].role !== "user") end++;
  }
  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  const oversized: SessionHistoryPage["oversized"] = [];
  let bytes = 0, turns = 0;
  while (end > 0 && turns < HISTORY_PAGE_TURNS) {
    let start = end - 1;
    while (start > 0 && full.messages[start].role !== "user") start--;
    const raw = full.messages.slice(start, end);
    const size = Buffer.byteLength(JSON.stringify(raw), "utf8");
    if (turns && bytes + size > HISTORY_PAGE_BYTES) break;
    const anchors = full.entryIds.slice(start, end);
    if (size > HISTORY_PAGE_BYTES) {
      oversized.push({ id: anchors[0], anchors: [...new Set([anchors[0], ...(options.around ? [options.around] : []), ...anchors.slice(-64)])] });
      messages.unshift(oversizedMessage(raw.map(previewMessage).find(Boolean)));
      entryIds.unshift(anchors[0]);
      bytes += 128;
    } else {
      messages.unshift(...raw);
      entryIds.unshift(...anchors);
      bytes += size;
    }
    end = start;
    turns++;
  }
  const historyPage = { older: cursorFor(generation, leafId, end && entryIds[0] ? entryIds[0] : null), contextVersion: generation, oversized };
  return { leafId, historyPage,
    context: { ...full, messages, entryIds, modelChanges: full.modelChanges?.filter(notice => entryIds.includes(notice.afterEntryId)) },
    info: header ? sessionInfo(header, manager.getSessionName(), modified, messages.length, previewMessage(full.messages.find(message => message.role === "user")), path) : null,
    systemPromptBinding: summarizeSessionSystemPromptBinding(readLatestSessionSystemPromptBinding(entries)),
  };
}

export async function readSessionPage(path: string, modified: string, options: PageOptions = {}) {
  const leafId = options.cursor?.leafId ?? options.leafId;
  const result = await readInWorker<WorkerPage>("sessionPage", {
    path, leafId, around: options.around, before: options.cursor?.before, generation: options.cursor?.generation,
    turns: HISTORY_PAGE_TURNS, bytes: HISTORY_PAGE_BYTES,
  }, options.signal);
  if ("stale" in result) throw new SessionHistoryPageError(409, "History changed; refresh the conversation");
  if ("missingAnchor" in result) throw new SessionHistoryPageError(404, "History entry not found");
  if ("unsupported" in result) return legacyPage(path, modified, options);
  const context: SessionContext = {
    messages: [], entryIds: [], modelChanges: result.modelChanges, model: result.model, thinkingLevel: result.thinkingLevel,
  };
  let deletedBoundary = false;
  const previews = new Map(result.previews.map(preview => [preview.id, preview.messages]));
  for (const entry of result.entries) {
    if (entry.type === "oversize") {
      context.messages.push(oversizedMessage(previews.get(entry.id)?.map(item => item.text).join("\n\n")));
      context.entryIds.push(entry.id);
      deletedBoundary = false;
      continue;
    }
    if (isDeletedUser(entry)) {
      deletedBoundary = true;
      continue;
    }
    const message = entryToUiMessage(entry, { deferThinking: true, deferToolResultImages: true });
    if (!message) continue;
    context.messages.push(deletedBoundary && message.role !== "user" ? { ...message, followsDeletedPrompt: true } : message);
    context.entryIds.push(entry.id);
    deletedBoundary = false;
  }
  return {
    context, leafId: result.leafId,
    historyPage: {
      older: cursorFor(result.generation, result.leafId, result.before),
      contextVersion: result.contextVersion, oversized: result.oversize,
    } satisfies SessionHistoryPage,
    systemPromptBinding: summarizeSessionSystemPromptBinding(result.promptBinding ?? null),
    info: sessionInfo(result.header, result.name, modified, context.messages.length,
      previewMessage(context.messages.find(message => message.role === "user")), path),
  };
}

export async function querySessionPromptReceipts(path: string, ids: string[], anchors: string[], leafId?: string, signal?: AbortSignal) {
  if (!ids.length && !anchors.length) return { ids: [], activeAnchorIds: [] };
  const load = () => readInWorker<{ ids: string[]; activeAnchorIds: string[] } | { stale: true } | { unsupported: true }>("sessionReceipts", { path, ids, anchors, leafId }, signal);
  let result = await load();
  if ("stale" in result) result = await load();
  if ("ids" in result) return result;
  if ("stale" in result) throw new SessionHistoryPageError(409, "History changed; retry the receipt query");
  const manager = SessionManager.open(path);
  const entries = manager.getEntries();
  const matches = new Set(persistedMessagePromptIds(entries));
  const visible = anchors.length ? new Set(buildSessionContext(entries as unknown as SessionEntry[], leafId ?? manager.getLeafId()).entryIds) : new Set<string>();
  return { ids: ids.filter(id => matches.has(id)), activeAnchorIds: anchors.filter(id => visible.has(id)) };
}

export async function readSessionHistoryEntry(path: string, entryId: string, signal?: AbortSignal): Promise<SessionEntry | undefined> {
  const read = () => readInWorker<{ entry: SessionEntry | null } | { stale: true } | { unsupported: true }>("sessionEntry", { path, entryId }, signal);
  let result = await read();
  if ("stale" in result) result = await read();
  if ("entry" in result) return result.entry ?? undefined;
  if ("stale" in result) throw new SessionHistoryPageError(409, "History changed; retry the entry query");
  return (SessionManager.open(path).getEntries() as unknown as SessionEntry[]).find(entry => entry.id === entryId);
}

export async function readSessionStatistics(path: string, signal?: AbortSignal): Promise<SessionStatsInfo> {
  const read = () => readInWorker<{ stats: SessionStatsInfo } | { stale: true } | { unsupported: true }>("sessionStats", { path }, signal);
  let result = await read();
  if ("stale" in result) result = await read();
  if ("stats" in result) return result.stats;
  if ("stale" in result) throw new SessionHistoryPageError(409, "History changed; retry the statistics query");
  return summarizeSessionStats(SessionManager.open(path));
}

export async function readSessionPromptBinding(path: string, signal?: AbortSignal): Promise<SessionSystemPromptBinding | null> {
  const read = () => readInWorker<{ binding: SessionSystemPromptBinding | null } | { stale: true } | { unsupported: true }>("sessionPromptBinding", { path }, signal);
  let result = await read();
  if ("stale" in result) result = await read();
  if ("binding" in result) return result.binding;
  if ("stale" in result) throw new SessionHistoryPageError(409, "History changed; retry the system prompt query");
  return readLatestSessionSystemPromptBinding(SessionManager.open(path).getEntries());
}
