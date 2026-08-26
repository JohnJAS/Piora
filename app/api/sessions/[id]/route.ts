import { NextResponse } from "next/server";
import { statSync } from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  resolveSessionIdByPath,
  invalidateSessionPathCache,
  invalidateSessionListCache,
  buildSessionContext,
  listAllSessions,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { purgeExpiredTrash, trashSession } from "@/lib/session-trash";

// BranchNavigator still traverses recursively, so keep the response tree shallow.
const MAX_PROJECTED_TREE_DEPTH = 200;
const MAX_CACHED_SESSION_RESPONSES = 8;

/**
 * Project the session tree into the shallow navigation tree sent to the client.
 * Keeps roots, branch points, and leaves while contracting single-child chains
 * without recursive traversal. Contracted entry IDs are attached to the next
 * visible node so the UI can still recognize an active leaf inside the chain.
 */
function projectTreeForResponse<T extends { entry: { id: string }; children: T[]; compressedEntryIds?: string[] }>(
  nodes: T[]
): T[] {
  const keep = new Set<T>();
  const roots = new Set(nodes);
  const seen = new Set<T>();
  const stack = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);

    if (
      roots.has(node) ||
      node.children.length !== 1
    ) {
      keep.add(node);
    }

    for (const child of node.children) {
      stack.push(child);
    }
  }

  const cloneNode = (node: T, compressedEntryIds?: string[]): T => ({
    ...node,
    children: [],
    ...(compressedEntryIds?.length ? { compressedEntryIds } : {}),
  });
  const projectedRoots = nodes.map((node) => cloneNode(node));
  const tasks = nodes.map((source, index) => ({
    source,
    projected: projectedRoots[index],
    depth: 1,
  }));

  const appendFlattenedKeptDescendants = (source: T, projectedParent: T) => {
    const pending = [{ node: source, compressedEntryIds: [] as string[] }];
    const flattenedSeen = new Set<T>();

    while (pending.length > 0) {
      const { node, compressedEntryIds } = pending.pop()!;
      if (flattenedSeen.has(node)) continue;
      flattenedSeen.add(node);

      if (keep.has(node)) {
        projectedParent.children.push(cloneNode(node, compressedEntryIds));
      }

      for (let i = node.children.length - 1; i >= 0; i--) {
        pending.push({
          node: node.children[i],
          compressedEntryIds: keep.has(node)
            ? []
            : [...compressedEntryIds, node.entry.id],
        });
      }
    }
  };

  while (tasks.length > 0) {
    const { source, projected, depth } = tasks.pop()!;

    for (const sourceChild of source.children) {
      let child = sourceChild;

      if (depth >= MAX_PROJECTED_TREE_DEPTH) {
        appendFlattenedKeptDescendants(child, projected);
        continue;
      }

      const compressedEntryIds: string[] = [];
      while (!keep.has(child) && child.children.length === 1) {
        compressedEntryIds.push(child.entry.id);
        child = child.children[0];
      }

      if (!keep.has(child)) {
        continue;
      }

      const projectedChild = cloneNode(child, compressedEntryIds);
      projected.children.push(projectedChild);
      tasks.push({ source: child, projected: projectedChild, depth: depth + 1 });
    }
  }

  return projectedRoots;
}

async function buildSessionResponse(
  id: string,
  filePath: string,
  modified: string,
  deferThinking: boolean,
  deferToolResultImages: boolean,
) {
  const sm = SessionManager.open(filePath);
  const entries = sm.getEntries() as never;
  const leafId = sm.getLeafId();
  const tree = projectTreeForResponse(sm.getTree());
  const context = buildSessionContext(entries, leafId, { deferThinking, deferToolResultImages });
  const header = sm.getHeader();
  const parentSessionId = header?.parentSession
    ? await resolveSessionIdByPath(header.parentSession)
    : undefined;
  const info = header ? {
    path: filePath,
    id: header.id,
    cwd: header.cwd ?? "",
    name: sm.getSessionName(),
    created: header.timestamp,
    modified,
    messageCount: context.messages.length,
    firstMessage: context.messages.find((m) => m.role === "user")
      ? (() => {
          const msg = context.messages.find((m) => m.role === "user")!;
          const c = (msg as { content: unknown }).content;
          return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "");
        })()
      : "",
    parentSessionId,
  } : null;

  return {
    sessionId: id,
    filePath,
    info,
    leafId,
    tree,
    context,
  };
}

type SessionRoutePayload = Awaited<ReturnType<typeof buildSessionResponse>>;
type SessionResponseCacheEntry = {
  signature: string;
  lastAccessedAt: number;
  promise: Promise<SessionRoutePayload>;
};

declare global {
  var __pioraSessionResponseCache: Map<string, SessionResponseCacheEntry> | undefined;
}

function sessionResponseCache(): Map<string, SessionResponseCacheEntry> {
  if (!globalThis.__pioraSessionResponseCache) globalThis.__pioraSessionResponseCache = new Map();
  return globalThis.__pioraSessionResponseCache;
}

async function loadCachedSessionResponse(
  id: string,
  filePath: string,
  deferThinking: boolean,
  deferToolResultImages: boolean,
): Promise<SessionRoutePayload> {
  const fileState = statSync(filePath);
  const signature = `${fileState.size}:${fileState.mtimeMs}`;
  // Only retain the lightweight chat-switch projection. Full-history callers
  // may include large base64 media and should not occupy the in-process LRU.
  if (!deferThinking || !deferToolResultImages) {
    return buildSessionResponse(
      id,
      filePath,
      fileState.mtime.toISOString(),
      deferThinking,
      deferToolResultImages,
    );
  }
  const cacheKey = `${filePath}\0${deferThinking ? "thinking-deferred" : "thinking-full"}\0${deferToolResultImages ? "media-deferred" : "media-full"}`;
  const cache = sessionResponseCache();
  const existing = cache.get(cacheKey);
  if (existing?.signature === signature) {
    existing.lastAccessedAt = Date.now();
    return existing.promise;
  }

  const entry: SessionResponseCacheEntry = {
    signature,
    lastAccessedAt: Date.now(),
    promise: buildSessionResponse(
      id,
      filePath,
      fileState.mtime.toISOString(),
      deferThinking,
      deferToolResultImages,
    ),
  };
  cache.set(cacheKey, entry);
  while (cache.size > MAX_CACHED_SESSION_RESPONSES) {
    let oldest: [string, SessionResponseCacheEntry] | null = null;
    for (const candidate of cache) {
      if (!oldest || candidate[1].lastAccessedAt < oldest[1].lastAccessedAt) oldest = candidate;
    }
    if (!oldest) break;
    cache.delete(oldest[0]);
  }

  try {
    return await entry.promise;
  } catch (error) {
    if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
    throw error;
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const searchParams = new URL(req.url).searchParams;
    const deferThinking = searchParams.has("deferThinking");
    const deferToolResultImages = searchParams.has("deferMedia");
    return NextResponse.json(await loadCachedSessionResponse(
      id,
      filePath,
      deferThinking,
      deferToolResultImages,
    ));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(name.trim());
    invalidateSessionListCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
// Reversible delete (task T-01): the session's whole subtree is moved to the
// trash instead of being unlinked, so the 5s Undo window can move it back
// exactly (children keep their parentSession links — no cascade re-parenting
// needs to be reversed). Stale trash older than the undo window is purged on
// the next delete.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Collect the whole subtree (this session + every descendant that points
    // at a member via parentSessionId) so restore is an exact move-back.
    const all = await listAllSessions();
    const byId = new Map(all.map((s) => [s.id, s]));
    const subtreePaths: string[] = [];
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      const session = byId.get(current);
      if (session?.path) subtreePaths.push(session.path);
      for (const s of all) {
        if (s.parentSessionId === current) queue.push(s.id);
      }
    }

    getRpcSession(id)?.destroy();
    purgeExpiredTrash();
    trashSession(id, subtreePaths);
    // Invalidate path caches for every session in the subtree.
    for (const sessionId of seen) {
      invalidateSessionPathCache(sessionId);
    }
    invalidateSessionListCache();
    return NextResponse.json({ ok: true, trashedCount: subtreePaths.length });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
