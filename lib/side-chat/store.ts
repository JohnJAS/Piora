import { existsSync, mkdirSync, openSync, closeSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { bindSessionAgentRuntimeProfile } from "../agent-profile-store";
import { readRuntimeHomeOrFallback } from "./store-helpers";
import { restorePromptMaterialDisplayPreview } from "../prompt-materials";
import { getRuntimeAgentDataDirectory } from "../runtime-home";
import { isDeletedUserMessage } from "../session-message-delete";
import type { SessionEntry, SessionHeader } from "../types";
import { SIDE_BOUNDARY_CUSTOM_TYPE, SIDE_META_CUSTOM_TYPE } from "./policy";
import { isDefaultSideChatTitle } from "./composer-trigger";
import type { SideChatMetaEntry, SideChatSummary } from "./types";

function readJsonlHeader(filePath: string): SessionHeader | null {
  const fd = openSync(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    const maxHeaderBytes = 64 * 1024;
    let position = 0;
    let foundNewline = false;
    while (position < maxHeaderBytes && !foundNewline) {
      const buffer = Buffer.allocUnsafe(Math.min(4096, maxHeaderBytes - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const data = buffer.subarray(0, bytesRead);
      const newlineIndex = data.indexOf(0x0a);
      chunks.push(newlineIndex === -1 ? data : data.subarray(0, newlineIndex));
      position += bytesRead;
      foundNewline = newlineIndex !== -1;
    }
    if (!foundNewline && position >= maxHeaderBytes) return null;
    const firstLine = Buffer.concat(chunks).toString("utf8").trimEnd();
    if (!firstLine) return null;
    const header = JSON.parse(firstLine) as SessionHeader;
    return header.type === "session" ? header : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export const TEMPORARY_SIDE_CHAT_TTL_MS = 3 * 60 * 60 * 1000;

declare global {
  var __pioraSideChatPathCache: { root: string; byId: Map<string, string> } | undefined;
}

export function isValidSideChatSessionId(value: string): boolean {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[a-zA-Z0-9._-]+$/.test(value)
    && value !== "."
    && value !== ".."
    && !value.includes("..")
  );
}

export function assertValidSideChatSessionId(value: string, label = "session id"): string {
  if (!isValidSideChatSessionId(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function getSideChatsRoot(): string {
  return join(getRuntimeAgentDataDirectory(), "piora", "side-chats");
}

export function getParentSideChatsDirectory(parentSessionId: string): string {
  assertValidSideChatSessionId(parentSessionId, "parent session id");
  return join(getSideChatsRoot(), parentSessionId);
}

function getPathCache(): Map<string, string> {
  const root = getSideChatsRoot();
  if (!globalThis.__pioraSideChatPathCache || globalThis.__pioraSideChatPathCache.root !== root) {
    globalThis.__pioraSideChatPathCache = { root, byId: new Map() };
  }
  return globalThis.__pioraSideChatPathCache.byId;
}

export function cacheSideChatPath(sideSessionId: string, filePath: string): void {
  assertValidSideChatSessionId(sideSessionId, "side chat session id");
  getPathCache().set(sideSessionId, resolve(filePath));
}

export function invalidateSideChatCache(sideSessionId?: string): void {
  if (!sideSessionId) {
    globalThis.__pioraSideChatPathCache = undefined;
    return;
  }
  getPathCache().delete(sideSessionId);
}

function isInsideRoot(targetPath: string, rootDir: string): boolean {
  const resolvedTarget = resolve(targetPath);
  const resolvedRoot = resolve(rootDir);
  const targetCmp = process.platform === "win32" ? resolvedTarget.toLowerCase() : resolvedTarget;
  const rootCmp = process.platform === "win32" ? resolvedRoot.toLowerCase() : resolvedRoot;
  const sep = process.platform === "win32" ? "\\" : "/";
  return targetCmp === rootCmp || targetCmp.startsWith(rootCmp.endsWith(sep) ? rootCmp : `${rootCmp}${sep}`);
}

/** Resolve an isolated side-chat JSONL file by its session ID, scanning on cache miss. */
export function resolveSideChatPath(sideSessionId: string): string | null {
  if (!isValidSideChatSessionId(sideSessionId)) return null;
  const root = getSideChatsRoot();
  const cache = getPathCache();
  const cached = cache.get(sideSessionId);
  if (cached && isInsideRoot(cached, root) && existsSync(cached)) {
    return cached;
  }
  cache.delete(sideSessionId);
  if (!existsSync(root)) return null;

  let parentDirs: string[];
  try {
    parentDirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isValidSideChatSessionId(entry.name))
      .map((entry) => join(root, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  for (const dir of parentDirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const fullPath = join(dir, file);
      try {
        const header = readJsonlHeader(fullPath);
        if (header?.id) {
          cache.set(header.id, fullPath);
          if (header.id === sideSessionId) return fullPath;
        }
      } catch {
        // Ignore unreadable or partially removed files during discovery.
      }
    }
  }
  return null;
}

/** Parse the latest `piora-side-conversation` metadata entry from session entries. */
export function readSideChatMetaFromEntries(entries: readonly unknown[]): SideChatMetaEntry | undefined {
  let latest: SideChatMetaEntry | undefined;
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry.type !== "custom" || entry.customType !== SIDE_META_CUSTOM_TYPE) continue;
    const data = entry.data as Partial<SideChatMetaEntry> | undefined;
    if (
      !data
      || typeof data !== "object"
      || data.version !== 1
      || typeof data.parentSessionId !== "string"
      || !isValidSideChatSessionId(data.parentSessionId)
      || (data.storage !== "attached" && data.storage !== "temporary")
      || typeof data.boundaryEntryId !== "string"
      || !data.boundaryEntryId
    ) {
      continue;
    }
    latest = {
      version: 1,
      parentSessionId: data.parentSessionId,
      storage: data.storage,
      boundaryEntryId: data.boundaryEntryId,
      createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
      ...(data.inheritedLeafId !== undefined ? { inheritedLeafId: data.inheritedLeafId } : {}),
      ...(typeof data.archived === "boolean" ? { archived: data.archived } : {}),
      ...(typeof data.archivedAt === "string" ? { archivedAt: data.archivedAt } : {}),
    };
  }
  return latest;
}

export function isTemporarySideChatExpired(
  meta: Pick<SideChatMetaEntry, "storage">,
  modifiedMs: number,
  now = Date.now(),
): boolean {
  return meta.storage === "temporary" && Number.isFinite(modifiedMs) && now - modifiedMs >= TEMPORARY_SIDE_CHAT_TTL_MS;
}

function extractUserMessageText(content: unknown): string {
  if (typeof content === "string") return restorePromptMaterialDisplayPreview(content).trim();
  if (!Array.isArray(content)) return "";
  const textParts = content
    .filter((block): block is { type?: string; text?: string } => Boolean(block && typeof block === "object" && (block as { type?: string }).type === "text" && typeof (block as { text?: unknown }).text === "string"))
    .map((block) => restorePromptMaterialDisplayPreview(block.text ?? ""))
    .join(" ")
    .trim();
  if (textParts) return textParts;
  if (content.some((block) => block && typeof block === "object" && (block as { type?: string }).type === "image")) {
    return "[Image]";
  }
  return "";
}

/** Extract post-boundary turn count and first user preview without leaking inherited parent turns. */
export function summarizePostBoundaryTranscript(entries: readonly SessionEntry[]): { messageCount: number; preview: string } {
  let boundaryIndex = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as { type?: unknown; customType?: unknown };
    if (entry.type === "custom_message" && entry.customType === SIDE_BOUNDARY_CUSTOM_TYPE) {
      boundaryIndex = i;
      break;
    }
  }
  const postEntries = boundaryIndex >= 0 ? entries.slice(boundaryIndex + 1) : entries;
  let messageCount = 0;
  let preview = "";
  for (const entry of postEntries) {
    if (entry.type !== "message" || isDeletedUserMessage(entry)) continue;
    const role = (entry.message as { role?: string } | undefined)?.role;
    if (role !== "user" && role !== "assistant") continue;
    messageCount += 1;
    if (!preview && role === "user") {
      preview = extractUserMessageText((entry.message as { content?: unknown }).content).slice(0, 240);
    }
  }
  return { messageCount, preview };
}

export interface ListSideChatsOptions {
  includeArchived?: boolean;
  includeTemporary?: boolean;
  runningIds?: ReadonlySet<string>;
  failedIds?: ReadonlySet<string>;
  liveNames?: ReadonlyMap<string, string>;
  now?: number;
}

/**
 * List side chats belonging to `parentSessionId`, purging expired inactive temporary
 * side chats along the way so temporary transcripts do not accumulate indefinitely.
 */
export function listSideChatsForParent(
  parentSessionId: string,
  options: ListSideChatsOptions = {},
): SideChatSummary[] {
  if (!isValidSideChatSessionId(parentSessionId)) return [];
  const dir = getParentSideChatsDirectory(parentSessionId);
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const now = options.now ?? Date.now();
  const summaries: SideChatSummary[] = [];
  for (const file of files) {
    const fullPath = join(dir, file);
    try {
      const stat = statSync(fullPath);
      const sm = SessionManager.open(fullPath, dir);
      const header = sm.getHeader();
      if (!header?.id) continue;
      cacheSideChatPath(header.id, fullPath);
      const entries = sm.getEntries() as unknown as SessionEntry[];
      const meta = readSideChatMetaFromEntries(entries);
      if (!meta || meta.parentSessionId !== parentSessionId) continue;

      const running = options.runningIds?.has(header.id) ?? false;
      const expired = !running && isTemporarySideChatExpired(meta, stat.mtimeMs, now);
      if (expired) {
        deleteSideChatFileByPath(fullPath, header.id);
        continue;
      }
      if (meta.storage === "temporary" && options.includeTemporary === false) continue;
      const archived = meta.archived === true;
      if (archived && !options.includeArchived) continue;

      const leafId = sm.getLeafId();
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      const activeBranch: SessionEntry[] = [];
      let current = leafId ? byId.get(leafId) : entries.at(-1);
      while (current) {
        activeBranch.push(current);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      activeBranch.reverse();

      const { messageCount, preview } = summarizePostBoundaryTranscript(activeBranch);
      const rawName = (options.liveNames?.get(header.id) ?? sm.getSessionName() ?? "").trim();
      const createdAt = meta.createdAt || header.timestamp;
      const modifiedAt = stat.mtime instanceof Date ? stat.mtime.toISOString() : new Date(stat.mtimeMs).toISOString();
      summaries.push({
        id: header.id,
        parentSessionId,
        cwd: header.cwd ?? "",
        title: rawName || "Side chat",
        isDefaultTitle: isDefaultSideChatTitle(rawName),
        preview,
        storage: meta.storage,
        archived,
        expired: false,
        createdAt,
        modifiedAt,
        messageCount,
        running,
        ...(options.failedIds?.has(header.id) ? { lastPromptFailed: true } : {}),
      });
    } catch {
      // Skip malformed side-chat files rather than failing the whole list.
    }
  }

  return summaries.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));
}

export function readSideChatSummaryByPath(
  filePath: string,
  options: Pick<ListSideChatsOptions, "runningIds" | "failedIds" | "liveNames" | "now"> = {},
): SideChatSummary | null {
  if (!existsSync(filePath)) return null;
  const stat = statSync(filePath);
  const sm = SessionManager.open(filePath, dirname(filePath));
  const header = sm.getHeader();
  if (!header?.id) return null;
  const entries = sm.getEntries() as unknown as SessionEntry[];
  const meta = readSideChatMetaFromEntries(entries);
  if (!meta) return null;
  const { messageCount, preview } = summarizePostBoundaryTranscript(entries);
  const rawName = (options.liveNames?.get(header.id) ?? sm.getSessionName() ?? "").trim();
  const running = options.runningIds?.has(header.id) ?? false;
  return {
    id: header.id,
    parentSessionId: meta.parentSessionId,
    cwd: header.cwd ?? "",
    title: rawName || "Side chat",
    isDefaultTitle: isDefaultSideChatTitle(rawName),
    preview,
    storage: meta.storage,
    archived: meta.archived === true,
    expired: !running && isTemporarySideChatExpired(meta, stat.mtimeMs, options.now),
    createdAt: meta.createdAt || header.timestamp,
    modifiedAt: stat.mtime instanceof Date ? stat.mtime.toISOString() : new Date(stat.mtimeMs).toISOString(),
    messageCount,
    running,
    ...(options.failedIds?.has(header.id) ? { lastPromptFailed: true } : {}),
  };
}

/** Update the archived state stored on a side chat file. */
export function setSideChatArchived(sideSessionId: string, archived: boolean): SideChatMetaEntry {
  const filePath = resolveSideChatPath(sideSessionId);
  if (!filePath) throw new Error(`Side chat ${sideSessionId} was not found.`);
  const sm = SessionManager.open(filePath, dirname(filePath));
  const meta = readSideChatMetaFromEntries(sm.getEntries());
  if (!meta) throw new Error(`Session ${sideSessionId} is not a side chat.`);
  const next: SideChatMetaEntry = {
    ...meta,
    archived,
    ...(archived ? { archivedAt: new Date().toISOString() } : { archivedAt: undefined }),
  };
  sm.appendCustomEntry(SIDE_META_CUSTOM_TYPE, next);
  return next;
}

function deleteSideChatFileByPath(filePath: string, sideSessionId?: string): void {
  const root = getSideChatsRoot();
  if (!isInsideRoot(filePath, root)) {
    throw new Error("Refusing to delete file outside side-chats directory.");
  }
  rmSync(filePath, { force: true });
  invalidateSideChatCache(sideSessionId);
  const parentDir = dirname(filePath);
  if (isInsideRoot(parentDir, root) && resolve(parentDir) !== resolve(root)) {
    try {
      if (readdirSync(parentDir).length === 0) {
        rmSync(parentDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup race.
    }
  }
}

export function deleteSideChatFile(sideSessionId: string): boolean {
  const filePath = resolveSideChatPath(sideSessionId);
  if (!filePath) return false;
  deleteSideChatFileByPath(filePath, sideSessionId);
  return true;
}

/** Collect every side-chat session ID and file path owned by a list of parent session IDs. */
export function collectSideChatFilesForParents(parentSessionIds: readonly string[]): {
  ids: string[];
  files: string[];
} {
  const ids: string[] = [];
  const files: string[] = [];
  const seenFiles = new Set<string>();
  const root = getSideChatsRoot();
  for (const parentId of parentSessionIds) {
    if (!isValidSideChatSessionId(parentId)) continue;
    const dir = join(root, parentId);
    if (!existsSync(dir)) continue;
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const name of names) {
      const fullPath = join(dir, name);
      if (seenFiles.has(fullPath)) continue;
      seenFiles.add(fullPath);
      files.push(fullPath);
      try {
        const header = readJsonlHeader(fullPath);
        if (header?.id) ids.push(header.id);
      } catch {
        // Still include file path so parent trash captures everything in the parent's folder.
      }
    }
  }
  return { ids, files };
}

/**
 * Promote a side chat into an independent standalone session inside the
 * standard Pi sessions tree without mutating the source side chat file.
 */
export async function promoteSideChatToStandaloneSession(sideSessionId: string): Promise<{
  sessionId: string;
  filePath: string;
  cwd: string;
  name?: string;
}> {
  const sourcePath = resolveSideChatPath(sideSessionId);
  if (!sourcePath) throw new Error(`Side chat ${sideSessionId} was not found.`);
  const sourceSm = SessionManager.open(sourcePath, dirname(sourcePath));
  const header = sourceSm.getHeader();
  if (!header) throw new Error("Side chat header is missing.");
  const cwd = readRuntimeHomeOrFallback(header.cwd);
  const meta = readSideChatMetaFromEntries(sourceSm.getEntries());
  if (!meta) throw new Error("Target session is not a side chat.");

  const branch = sourceSm.getBranch();
  const retained = [];
  let pathParentId: string | null = null;
  for (const entry of branch) {
    if (entry.type === "label") continue;
    if (entry.type === "custom" && entry.customType === SIDE_META_CUSTOM_TYPE) continue;
    if (entry.type === "custom_message" && entry.customType === SIDE_BOUNDARY_CUSTOM_TYPE) continue;
    retained.push({ ...entry, parentId: pathParentId });
    pathParentId = entry.id;
  }

  const newSessionId = randomUUID();
  const timestamp = new Date().toISOString();
  const fileTimestamp = timestamp.replace(/[:.]/g, "-");
  const targetDir = SessionManager.create(cwd).getSessionDir();
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const targetFile = join(targetDir, `${fileTimestamp}_${newSessionId}.jsonl`);

  const newHeader = {
    type: "session" as const,
    version: header.version ?? 3,
    id: newSessionId,
    timestamp,
    cwd,
  };
  const lines = [newHeader, ...retained].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  writeFileSync(targetFile, lines, { encoding: "utf8", flag: "wx", mode: 0o600 });

  await bindSessionAgentRuntimeProfile(newSessionId, "normal");

  const sourceName = sourceSm.getSessionName()?.trim();
  const cleanName = sourceName && !/^(?:Side chat(?:\s+\d+)?|侧边对话(?:\s*\d+)?)$/i.test(sourceName)
    ? sourceName
    : undefined;
  if (cleanName) {
    SessionManager.open(targetFile, targetDir).appendSessionInfo(cleanName);
  }
  return { sessionId: newSessionId, filePath: targetFile, cwd, name: cleanName };
}

export function getSideChatFilenameBase(filePath: string): string {
  return basename(filePath);
}
