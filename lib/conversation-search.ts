import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionFlags } from "./session-flags";
import type { SessionInfo } from "./types";

export const CONVERSATION_SEARCH_QUERY_LIMIT = 200;
export const CONVERSATION_SEARCH_RESULT_LIMIT = 100;
const CONVERSATION_SEARCH_CACHE_LIMIT = 512;

export type ConversationArchiveFilter = "active" | "archived" | "all";
export type ConversationSearchRole = "user" | "assistant";

export interface ConversationSearchResult {
  sessionId: string;
  entryId: string;
  role: ConversationSearchRole;
  title: string;
  snippet: string;
  matchStart: number;
  matchLength: number;
  timestamp: string;
  projectLabel: string;
  archived: boolean;
}

export interface ConversationSearchResponse {
  results: ConversationSearchResult[];
  durationMs: number;
  truncated: boolean;
}

export interface ConversationSearchOptions {
  archive: ConversationArchiveFilter;
  limit?: number;
  project?: string | null;
  query: string;
}

interface SearchableMessage {
  entryId: string;
  targetEntryId: string;
  role: ConversationSearchRole;
  text: string;
  timestamp: string;
}

interface SearchFileCacheEntry {
  mtimeMs: number;
  size: number;
  messages: SearchableMessage[];
}

declare global {
  var __pioraConversationSearchCache: Map<string, SearchFileCacheEntry> | undefined;
}

function getCache(): Map<string, SearchFileCacheEntry> {
  globalThis.__pioraConversationSearchCache ??= new Map();
  return globalThis.__pioraConversationSearchCache;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => (
      Boolean(block)
      && typeof block === "object"
      && (block as { type?: unknown }).type === "text"
      && typeof (block as { text?: unknown }).text === "string"
    ))
    .map((block) => block.text)
    .join("\n");
}

function normalizedTimestamp(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return fallback;
}

export async function readSearchableMessages(filePath: string, fallbackTimestamp = ""): Promise<SearchableMessage[]> {
  const stat = statSync(filePath);
  const cache = getCache();
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    cache.delete(filePath);
    cache.set(filePath, cached);
    return cached.messages;
  }

  const messages: SearchableMessage[] = [];
  const messageById = new Map<string, SearchableMessage>();
  const parentById = new Map<string, string | null>();
  let lastEntryId: string | null = null;
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    try {
      const entry = JSON.parse(line) as {
        type?: unknown;
        id?: unknown;
        parentId?: unknown;
        timestamp?: unknown;
        message?: { role?: unknown; content?: unknown; timestamp?: unknown };
      };
      if (typeof entry.id === "string" && entry.type !== "session") {
        parentById.set(entry.id, typeof entry.parentId === "string" ? entry.parentId : null);
        lastEntryId = entry.id;
      }
      if (entry.type !== "message" || typeof entry.id !== "string" || !entry.message) continue;
      const role = entry.message.role;
      if (role !== "user" && role !== "assistant") continue;
      const text = textFromContent(entry.message.content).trim();
      if (!text) continue;
      const message: SearchableMessage = {
        entryId: entry.id,
        targetEntryId: entry.id,
        role,
        text,
        timestamp: normalizedTimestamp(entry.timestamp ?? entry.message.timestamp, fallbackTimestamp),
      };
      messages.push(message);
      messageById.set(message.entryId, message);
    } catch {
      // Ignore a partially-written or malformed JSONL line. Session browsing
      // follows the same resilience principle and the next file change will
      // invalidate this cache entry.
    }
  }

  const activeEntryIds = new Set<string>();
  let cursor = lastEntryId;
  while (cursor && !activeEntryIds.has(cursor)) {
    activeEntryIds.add(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
  const activeMessages = messages.filter((message) => activeEntryIds.has(message.entryId));
  const selectedMessages = activeMessages.length > 0 ? activeMessages : messages;
  const searchableMessages = selectedMessages.map((message) => {
    if (message.role === "user") return message;
    let parentId = parentById.get(message.entryId) ?? null;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parentMessage = messageById.get(parentId);
      if (parentMessage?.role === "user") return { ...message, targetEntryId: parentMessage.entryId };
      parentId = parentById.get(parentId) ?? null;
    }
    return message;
  });
  cache.delete(filePath);
  cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, messages: searchableMessages });
  while (cache.size > CONVERSATION_SEARCH_CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
  return searchableMessages;
}

function projectKeyFor(session: SessionInfo): string {
  return session.projectless ? "__projectless__" : session.projectRoot ?? session.cwd;
}

function projectLabelFor(session: SessionInfo): string {
  if (session.projectless) return "Chats";
  const value = session.projectRoot ?? session.cwd;
  return (value.split(/[\\/]/).filter(Boolean).at(-1) ?? value).slice(0, 160);
}

function titleFor(session: SessionInfo): string {
  return (session.name?.trim() || session.firstMessage?.trim() || "Untitled chat").slice(0, 160);
}

function buildSnippet(text: string, matchIndex: number, matchLength: number): Pick<ConversationSearchResult, "snippet" | "matchStart" | "matchLength"> {
  const compact = text.replace(/\s+/g, " ").trim();
  const normalizedPrefix = text.slice(0, matchIndex).replace(/\s+/g, " ").trimStart();
  const compactMatchIndex = Math.min(compact.length, normalizedPrefix.length);
  const context = 88;
  const start = Math.max(0, compactMatchIndex - context);
  const end = Math.min(compact.length, compactMatchIndex + matchLength + context);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < compact.length ? "…" : "";
  return {
    snippet: `${prefix}${compact.slice(start, end)}${suffix}`,
    matchStart: prefix.length + compactMatchIndex - start,
    matchLength: Math.min(matchLength, Math.max(0, compact.length - compactMatchIndex)),
  };
}

export function normalizeConversationSearchOptions(input: Partial<ConversationSearchOptions>): ConversationSearchOptions {
  const query = typeof input.query === "string"
    ? input.query.trim().slice(0, CONVERSATION_SEARCH_QUERY_LIMIT)
    : "";
  const archive = input.archive === "active" || input.archive === "archived" || input.archive === "all"
    ? input.archive
    : "all";
  const requestedLimit = Number.isFinite(input.limit) ? Math.floor(input.limit as number) : 50;
  return {
    query,
    archive,
    project: typeof input.project === "string" && input.project.trim() ? input.project.trim() : null,
    limit: Math.max(1, Math.min(CONVERSATION_SEARCH_RESULT_LIMIT, requestedLimit)),
  };
}

export async function searchConversationSessions(
  sessions: SessionInfo[],
  flags: SessionFlags,
  rawOptions: Partial<ConversationSearchOptions>,
): Promise<ConversationSearchResponse> {
  const startedAt = performance.now();
  const options = normalizeConversationSearchOptions(rawOptions);
  if (!options.query) return { results: [], durationMs: 0, truncated: false };

  const queryLower = options.query.toLocaleLowerCase();
  const candidates = sessions.filter((session) => {
    const archived = flags[session.id]?.archived === true;
    if (options.archive === "active" && archived) return false;
    if (options.archive === "archived" && !archived) return false;
    return !options.project || projectKeyFor(session) === options.project;
  }).sort((left, right) => (Date.parse(right.modified) || 0) - (Date.parse(left.modified) || 0));

  const matches: ConversationSearchResult[] = [];
  let totalMatches = 0;
  for (const session of candidates) {
    let searchable: SearchableMessage[];
    try {
      searchable = await readSearchableMessages(session.path, session.modified);
    } catch {
      continue;
    }
    for (let index = searchable.length - 1; index >= 0; index -= 1) {
      const message = searchable[index];
      const matchIndex = message.text.toLocaleLowerCase().indexOf(queryLower);
      if (matchIndex < 0) continue;
      totalMatches += 1;
      if (matches.length >= (options.limit ?? 50)) continue;
      matches.push({
        sessionId: session.id,
        entryId: message.targetEntryId,
        role: message.role,
        title: titleFor(session),
        ...buildSnippet(message.text, matchIndex, options.query.length),
        timestamp: message.timestamp || session.modified,
        projectLabel: projectLabelFor(session),
        archived: flags[session.id]?.archived === true,
      });
    }
  }

  matches.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  return {
    results: matches.slice(0, options.limit),
    durationMs: Math.round(performance.now() - startedAt),
    truncated: totalMatches > (options.limit ?? 50),
  };
}
