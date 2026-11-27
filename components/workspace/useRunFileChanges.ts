"use client";

import { useCallback, useEffect, useState } from "react";
import type { PromptFileChanges } from "@/lib/prompt-file-changes";
import { pollVisibleDocument } from "@/lib/visible-poller";

interface RunStart {
  sessionId: string;
  runId: string;
  timestamp: number;
}

function belongsToRun(snapshot: PromptFileChanges, start: RunStart | null) {
  return !start || snapshot.runId === start.runId || snapshot.startedAt > start.timestamp;
}

function sameSnapshot(previous: PromptFileChanges | null, next: PromptFileChanges) {
  return previous?.sessionId === next.sessionId && previous.runId === next.runId
    && previous.status === next.status && previous.finishedAt === next.finishedAt
    && previous.partial === next.partial && previous.files.length === next.files.length
    && previous.files.every((file, index) => file.path === next.files[index].path
      && file.kind === next.files[index].kind && file.patchRevision === next.files[index].patchRevision
      && file.additions === next.files[index].additions && file.deletions === next.files[index].deletions);
}

export function useRunFileChanges(sessionId: string | null, active: boolean, running: boolean, refreshKey: number) {
  const [loaded, setLoaded] = useState<PromptFileChanges | null>(null);
  const [lastStart, setLastStart] = useState<RunStart | null>(null);
  const start = lastStart?.sessionId === sessionId ? lastStart : null;
  const snapshot = loaded?.sessionId === sessionId && belongsToRun(loaded, start) ? loaded : null;

  const reportStart = useCallback((id: string, runId: string, timestamp: number) => {
    if (id === sessionId) setLastStart((current) => current?.sessionId === id
      && (current.runId === runId || current.timestamp > timestamp) ? current : { sessionId: id, runId, timestamp });
  }, [sessionId]);

  useEffect(() => {
    if (!active || !sessionId) return;
    let settlementReads = 0;
    const polling = pollVisibleDocument(async (signal) => {
      try {
        const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}/changes`, { cache: "no-store", signal });
        if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
        const data = response.ok ? await response.json() as PromptFileChanges | null : null;
        if (signal.aborted) return;
        if (data?.sessionId === sessionId && belongsToRun(data, start)) {
          setLoaded((current) => sameSnapshot(current, data) ? current : data);
          if (!running && data.status !== "running") { polling.stop(); return; }
        } else if (!data && !start && !running) {
          setLoaded((current) => current?.sessionId === sessionId ? null : current);
          polling.stop();
          return;
        }
      } catch {
        // A transient error can occur while the agent is creating the record.
      }
      if (!signal.aborted && !running && ++settlementReads >= 25) polling.stop();
    }, running ? 3000 : 1000);
    return () => polling.stop();
  }, [active, refreshKey, running, sessionId, start]);

  return { snapshot, reportStart };
}
