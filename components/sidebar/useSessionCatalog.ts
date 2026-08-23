"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { RUNNING_SESSIONS_POLL_MS, loadUnreadSessionIds, saveUnreadSessionIds } from "./sidebar-utils";

export interface SessionCompletionAnnouncement {
  count: number;
  title: string;
}

export function useSessionCatalog({ selectedSessionId, refreshKey }: { selectedSessionId: string | null; refreshKey?: number }) {
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const [completionAnnouncement, setCompletionAnnouncement] = useState<SessionCompletionAnnouncement | null>(null);
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  const runningPollAuthoritativeRef = useRef(false);
  const loadSessionsRequestIdRef = useRef(0);

  const loadSessions = useCallback(async (showLoading = false) => {
    const requestId = ++loadSessionsRequestIdRef.current;
    try {
      if (showLoading) setLoading(true);
      const response = await fetch("/api/sessions");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { sessions: SessionInfo[]; runningSessionIds?: string[] };
      if (loadSessionsRequestIdRef.current !== requestId) return;
      setAllSessions(data.sessions);
      if (!runningPollAuthoritativeRef.current) setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      const existingIds = new Set(data.sessions.map((session) => session.id));
      setUnreadSessionIds((previous) => {
        if (previous.size === 0) return previous;
        const next = new Set([...previous].filter((id) => existingIds.has(id)));
        return next.size === previous.size ? previous : next;
      });
      setError(null);
    } catch (caught) {
      if (loadSessionsRequestIdRef.current === requestId) setError(String(caught));
    } finally {
      // A background refresh can supersede the initial, loading-visible request
      // (for example when a room member finishes while the sidebar mounts).
      // Whichever request is newest owns settlement, even if it did not itself
      // turn the loading indicator on.
      if (loadSessionsRequestIdRef.current === requestId) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const first = !initialLoadDone.current;
    initialLoadDone.current = true;
    void loadSessions(first);
  }, [loadSessions, refreshKey]);

  useEffect(() => { saveUnreadSessionIds(unreadSessionIds); }, [unreadSessionIds]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };
    const schedule = () => {
      clearTimer();
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };
    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort(); controller = current;
      try {
        const response = await fetch("/api/agent/running", { cache: "no-store", signal: current.signal });
        if (!response.ok) return;
        const data = await response.json() as { runningSessionIds?: string[] };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      } catch { /* Preserve the last snapshot until the next visible poll. */ }
      finally { if (controller === current) controller = null; schedule(); }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void poll();
      else { clearTimer(); controller?.abort(); controller = null; }
    };
    void poll();
    document.addEventListener("visibilitychange", visibility);
    return () => { stopped = true; clearTimer(); controller?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completed = [...previous].filter((id) => !runningSessionIds.has(id));
    const unreadCompleted = completed.filter((id) => id !== selectedSessionId);
    if (completed.length > 0) {
      const latest = allSessions.find((session) => session.id === completed[completed.length - 1]);
      setCompletionAnnouncement({
        count: completed.length,
        title: latest?.name || latest?.firstMessage.slice(0, 80) || completed[completed.length - 1].slice(0, 12),
      });
    } else if (runningSessionIds.size > 0) {
      setCompletionAnnouncement(null);
    }
    if (unreadCompleted.length > 0 || runningSessionIds.size > 0) {
      setUnreadSessionIds((current) => {
        const next = new Set(current);
        runningSessionIds.forEach((id) => next.delete(id));
        unreadCompleted.forEach((id) => next.add(id));
        return next;
      });
    }
    if (completed.length > 0) void loadSessions(false);
    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [allSessions, loadSessions, runningSessionIds, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((previous) => {
      if (!previous.has(selectedSessionId)) return previous;
      const next = new Set(previous); next.delete(selectedSessionId); return next;
    });
  }, [selectedSessionId]);

  return { allSessions, loading, error, runningSessionIds, unreadSessionIds, completionAnnouncement, loadSessions };
}
