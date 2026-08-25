import type { SessionInfo } from "./types";

const PREFETCH_TTL_MS = 15_000;

interface PrefetchEntry {
  modified: string;
  createdAt: number;
  promise: Promise<unknown | null>;
}

const prefetchedSessions = new Map<string, PrefetchEntry>();

function createPrefetch(session: Pick<SessionInfo, "id" | "modified">): PrefetchEntry {
  const entry: PrefetchEntry = {
    modified: session.modified,
    createdAt: Date.now(),
    promise: fetch(`/api/sessions/${encodeURIComponent(session.id)}?deferThinking=1&deferMedia=1`)
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json() as { info?: { modified?: unknown } };
        // A background task can append to the file between hover and response.
        // Only reuse the payload when it still represents the sidebar version.
        return data.info?.modified === session.modified ? data : null;
      })
      .catch(() => null),
  };
  prefetchedSessions.set(session.id, entry);
  window.setTimeout(() => {
    if (prefetchedSessions.get(session.id) === entry) prefetchedSessions.delete(session.id);
  }, PREFETCH_TTL_MS);
  return entry;
}

export function prefetchSession(session: Pick<SessionInfo, "id" | "modified">): void {
  const existing = prefetchedSessions.get(session.id);
  if (existing && existing.modified === session.modified && Date.now() - existing.createdAt < PREFETCH_TTL_MS) return;
  void createPrefetch(session).promise;
}

export function takePrefetchedSession(
  session: Pick<SessionInfo, "id" | "modified">,
): Promise<unknown | null> | null {
  const entry = prefetchedSessions.get(session.id);
  if (!entry || entry.modified !== session.modified || Date.now() - entry.createdAt >= PREFETCH_TTL_MS) {
    return null;
  }
  prefetchedSessions.delete(session.id);
  return entry.promise;
}
