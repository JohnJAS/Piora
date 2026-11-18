"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRunningTaskRuntimeState } from "@/hooks/useTaskStatus";
import type { SessionInfo } from "@/lib/types";
import { filterMutedSessionIds } from "@/lib/project-notification-preferences";
import { loadUnreadSessionIds, saveUnreadSessionIds } from "./sidebar-utils";

export interface SessionCompletionAnnouncement {
  count: number;
  title: string;
}

export function useSessionCatalog({ selectedSessionId, refreshKey, mutedProjectRoots }: { selectedSessionId: string | null; refreshKey?: number; mutedProjectRoots: ReadonlySet<string> }) {
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [subagentParentIds, setSubagentParentIds] = useState<ReadonlySet<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [catalogComplete, setCatalogComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackRunningSessionIds, setFallbackRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const [completionAnnouncement, setCompletionAnnouncement] = useState<SessionCompletionAnnouncement | null>(null);
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  const loadSessionsRequest = useRef<AbortController | null>(null);
  const runtimeState = useRunningTaskRuntimeState();
  const subagentCounts = useMemo(() => new Map(runtimeState.snapshots.filter(snapshot => snapshot.runningSubagentCount)
    .map(snapshot => [snapshot.id, snapshot.runningSubagentCount!])), [runtimeState.snapshots]);
  const runningSessionIds = useMemo(() => {
    if (!runtimeState.ready) return fallbackRunningSessionIds;
    return new Set(runtimeState.snapshots
      .filter((snapshot) => snapshot.runtime !== "idle")
      .map((snapshot) => snapshot.id));
  }, [fallbackRunningSessionIds, runtimeState]);

  const loadSessions = useCallback(async (showLoading = false) => {
    loadSessionsRequest.current?.abort();
    const request = new AbortController();
    loadSessionsRequest.current = request;
    try {
      if (showLoading) setLoading(true);
      const sessions = new Map<string, SessionInfo>();
      const subagentParents = new Set<string>();
      let offset: number | null = 0;
      let version: string | undefined;
      let retried = false;
      while (offset !== null) {
        const query = new URLSearchParams({ view: "sidebar", offset: String(offset) });
        if (version) query.set("version", version);
        const response = await fetch("/api/sessions?" + query, { signal: request.signal });
        if (response.status === 409 && !retried) {
          retried = true;
          version = undefined;
          offset = 0;
          sessions.clear();
          subagentParents.clear();
          continue;
        }
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json() as { sessions: SessionInfo[]; runningSessionIds?: string[]; version?: string; nextOffset?: number | null; subagentParentIds?: string[] };
        if (request.signal.aborted) return;
        version = data.version;
        for (const session of data.sessions) sessions.set(session.id, session);
        for (const id of data.subagentParentIds ?? []) subagentParents.add(id);
        if (offset === 0) setFallbackRunningSessionIds(new Set(data.runningSessionIds ?? []));
        if (offset === 0 && showLoading) {
          setAllSessions([...sessions.values()]);
          setSubagentParentIds(new Set(subagentParents));
          setLoading(false);
        }
        offset = typeof data.nextOffset === "number" && data.nextOffset > offset ? data.nextOffset : null;
      }
      if (request.signal.aborted) return;
      setAllSessions([...sessions.values()]);
      setSubagentParentIds(subagentParents);
      const existingIds = new Set(sessions.keys());
      setUnreadSessionIds((previous) => {
        if (previous.size === 0) return previous;
        const next = new Set([...previous].filter((id) => existingIds.has(id)));
        return next.size === previous.size ? previous : next;
      });
      setError(null);
    } catch (caught) {
      if (!request.signal.aborted) setError(String(caught));
    } finally {
      if (loadSessionsRequest.current === request) {
        loadSessionsRequest.current = null;
        setCatalogComplete(true);
        setLoading(false);
      }
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const first = !initialLoadDone.current;
    initialLoadDone.current = true;
    void loadSessions(first);
  }, [loadSessions, refreshKey]);
  useEffect(() => () => { loadSessionsRequest.current?.abort(); loadSessionsRequest.current = null; }, []);

  const subagentPresenceVersion = runtimeState.subagentPresenceVersion;
  const sessionIdList = useMemo(() => JSON.stringify(allSessions.map(session => session.id).sort()), [allSessions]);
  useEffect(() => {
    if (!subagentPresenceVersion || !catalogComplete) return;
    const ids = JSON.parse(sessionIdList) as string[];
    if (!ids.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const parents = new Set<string>();
        for (let offset = 0; offset < ids.length; offset += 128) {
          const query = new URLSearchParams({ view: "subagents" });
          for (const id of ids.slice(offset, offset + 128)) query.append("sessionId", id);
          const response = await fetch("/api/sessions?" + query, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), cache: "no-store" });
          if (!response.ok) throw new Error("Could not refresh subagent presence");
          const result = await response.json() as { subagentParentIds?: string[] };
          for (const id of result.subagentParentIds ?? []) parents.add(id);
        }
        if (!controller.signal.aborted) setSubagentParentIds(parents);
      } catch {
        if (!controller.signal.aborted) timer = setTimeout(() => void load(), 5_000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionIdList, catalogComplete, subagentPresenceVersion]);


  useEffect(() => { saveUnreadSessionIds(unreadSessionIds); }, [unreadSessionIds]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completed = [...previous].filter((id) => !runningSessionIds.has(id));
    const completedWithPrompts = filterMutedSessionIds(completed, allSessions, mutedProjectRoots);
    const unreadCompleted = completedWithPrompts.filter((id) => id !== selectedSessionId);
    if (completedWithPrompts.length > 0) {
      const latestId = completedWithPrompts[completedWithPrompts.length - 1];
      const latest = allSessions.find((session) => session.id === latestId);
      setCompletionAnnouncement({
        count: completedWithPrompts.length,
        title: latest?.name || latest?.firstMessage.slice(0, 80) || latestId.slice(0, 12),
      });
    } else if (completed.length > 0 || runningSessionIds.size > 0) {
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
    if (completed.length > 0) {
      const completedIds = new Set(completed);
      const modified = new Date().toISOString();
      setAllSessions((current) => current.map((session) => (
        completedIds.has(session.id) ? { ...session, modified } : session
      )));
    }
    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [allSessions, mutedProjectRoots, runningSessionIds, selectedSessionId]);

  useEffect(() => {
    setUnreadSessionIds((previous) => {
      const next = new Set(filterMutedSessionIds(previous, allSessions, mutedProjectRoots));
      return next.size === previous.size ? previous : next;
    });
  }, [allSessions, mutedProjectRoots]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((previous) => {
      if (!previous.has(selectedSessionId)) return previous;
      const next = new Set(previous); next.delete(selectedSessionId); return next;
    });
  }, [selectedSessionId]);

  const markSessionUnread = useCallback((sessionId: string) => {
    setUnreadSessionIds((previous) => {
      if (previous.has(sessionId)) return previous;
      const next = new Set(previous);
      next.add(sessionId);
      return next;
    });
  }, []);

  return { allSessions, loading, catalogComplete, error, runningSessionIds, unreadSessionIds, completionAnnouncement, loadSessions, markSessionUnread, subagentParentIds, subagentCounts };
}
