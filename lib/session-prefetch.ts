import type { SessionInfo } from "./types";

const PREFETCH_TTL_MS = 30_000;
const MAX_PREFETCHED_SESSIONS = 6;

interface PrefetchEntry {
  modified: string;
  createdAt: number;
  lastAccessedAt: number;
  promise: Promise<unknown | null>;
}

const prefetchedSessions = new Map<string, PrefetchEntry>();

function prunePrefetchedSessions(now = Date.now()): void {
  for (const [sessionId, entry] of prefetchedSessions) {
    if (now - entry.createdAt >= PREFETCH_TTL_MS) prefetchedSessions.delete(sessionId);
  }
  while (prefetchedSessions.size >= MAX_PREFETCHED_SESSIONS) {
    let oldest: [string, PrefetchEntry] | null = null;
    for (const candidate of prefetchedSessions) {
      if (!oldest || candidate[1].lastAccessedAt < oldest[1].lastAccessedAt) oldest = candidate;
    }
    if (!oldest) break;
    prefetchedSessions.delete(oldest[0]);
  }
}

function createPrefetch(session: Pick<SessionInfo, "id" | "modified">): PrefetchEntry {
  const createdAt = Date.now();
  const entry: PrefetchEntry = {
    modified: session.modified,
    createdAt,
    lastAccessedAt: createdAt,
    promise: fetch(`/api/sessions/${encodeURIComponent(session.id)}?deferThinking=1&deferMedia=1`)
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json() as { info?: { modified?: unknown } };
        // Preserve the exact version returned by the server. If a task appended
        // after the sidebar snapshot, the fresher payload is safe to display but
        // will no longer match that stale sidebar version on a later switch.
        if (typeof data.info?.modified === "string") entry.modified = data.info.modified;
        return data;
      })
      .catch(() => null),
  };
  prunePrefetchedSessions(createdAt);
  prefetchedSessions.set(session.id, entry);
  void entry.promise.then((data) => {
    if (!data && prefetchedSessions.get(session.id) === entry) prefetchedSessions.delete(session.id);
  });
  window.setTimeout(() => {
    if (prefetchedSessions.get(session.id) === entry) prefetchedSessions.delete(session.id);
  }, PREFETCH_TTL_MS);
  return entry;
}

export function prefetchSession(session: Pick<SessionInfo, "id" | "modified">): void {
  prunePrefetchedSessions();
  const existing = prefetchedSessions.get(session.id);
  if (existing && existing.modified === session.modified && Date.now() - existing.createdAt < PREFETCH_TTL_MS) {
    existing.lastAccessedAt = Date.now();
    return;
  }
  void createPrefetch(session).promise;
}

export function takePrefetchedSession(
  session: Pick<SessionInfo, "id" | "modified">,
): Promise<unknown | null> | null {
  prunePrefetchedSessions();
  const entry = prefetchedSessions.get(session.id);
  if (!entry || entry.modified !== session.modified || Date.now() - entry.createdAt >= PREFETCH_TTL_MS) {
    return createPrefetch(session).promise;
  }
  entry.lastAccessedAt = Date.now();
  return entry.promise;
}

export function invalidatePrefetchedSession(sessionId: string): void {
  prefetchedSessions.delete(sessionId);
}
