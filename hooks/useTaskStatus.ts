"use client";

import { useSyncExternalStore } from "react";
import {
  deriveTaskStatus,
  type RunningSessionsPayload,
  type Runtime,
  type TaskRuntimeSnapshot,
  type TaskStatus,
} from "@/lib/task-status";

interface UseTaskStatusOptions {
  sessionId: string;
  archived?: boolean;
  isViewing?: boolean;
  hasUnreadResult?: boolean;
  fallbackRuntime?: Runtime;
}

const runtimeBySession = new Map<string, TaskRuntimeSnapshot>();
const listeners = new Set<() => void>();
let version = 0;
let eventSource: EventSource | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityBound = false;

function emitChange(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function applyPayload(payload: Partial<RunningSessionsPayload>): void {
  const next = new Map<string, TaskRuntimeSnapshot>();
  if (Array.isArray(payload.runningSessions)) {
    for (const session of payload.runningSessions) {
      if (!session || typeof session.id !== "string") continue;
      next.set(session.id, session);
    }
  } else {
    for (const id of payload.runningSessionIds ?? []) {
      next.set(id, {
        id,
        runtime: "running",
        pendingApproval: false,
        lastPromptFailed: false,
      });
    }
  }

  const previous = JSON.stringify([...runtimeBySession.values()].sort((a, b) => a.id.localeCompare(b.id)));
  const incoming = JSON.stringify([...next.values()].sort((a, b) => a.id.localeCompare(b.id)));
  if (previous === incoming) return;
  runtimeBySession.clear();
  for (const [id, session] of next) runtimeBySession.set(id, session);
  emitChange();
}

async function pollSnapshot(): Promise<void> {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  try {
    const response = await fetch("/api/agent/running", { cache: "no-store" });
    if (response.ok) applyPayload(await response.json() as RunningSessionsPayload);
  } catch {
    // SSE reconnect and the next fallback poll both retry automatically.
  }
}

function scheduleFallbackPoll(): void {
  if (pollTimer !== null || listeners.size === 0) return;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollSnapshot().finally(scheduleFallbackPoll);
  }, 2_500);
}

function connect(): void {
  if (typeof window === "undefined" || eventSource || listeners.size === 0) return;
  void pollSnapshot();
  eventSource = new EventSource("/api/agent/running/events");
  eventSource.onmessage = (message) => {
    try {
      const payload = JSON.parse(message.data) as { type?: string } & RunningSessionsPayload;
      if (!payload.type || payload.type === "running") applyPayload(payload);
    } catch {
      // Ignore malformed frames while keeping the stream alive.
    }
  };
  eventSource.onerror = scheduleFallbackPoll;

  if (!visibilityBound) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityBound = true;
  }
}

function disconnect(): void {
  if (listeners.size > 0) return;
  eventSource?.close();
  eventSource = null;
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
  if (visibilityBound) {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    visibilityBound = false;
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible") void pollSnapshot();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    disconnect();
  };
}

function getVersion(): number {
  return version;
}

function getRunningSnapshots(): TaskRuntimeSnapshot[] {
  return [...runtimeBySession.values()]
    .filter((snapshot) => snapshot.runtime !== "idle" || snapshot.pendingApproval || snapshot.lastPromptFailed || snapshot.goal)
    .sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0));
}

export function useRunningTaskSnapshots(): TaskRuntimeSnapshot[] {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return getRunningSnapshots();
}

export function useTaskStatus({
  sessionId,
  archived = false,
  isViewing = false,
  hasUnreadResult = false,
  fallbackRuntime = "idle",
}: UseTaskStatusOptions): TaskStatus {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const snapshot = runtimeBySession.get(sessionId);
  const runtime = snapshot?.runtime ?? fallbackRuntime;
  const runningIds = runtime === "running" || runtime === "stopping" ? new Set([sessionId]) : new Set<string>();
  const compactingIds = runtime === "compacting" ? new Set([sessionId]) : new Set<string>();
  const pendingApprovalIds = snapshot?.pendingApproval ? new Set([sessionId]) : new Set<string>();

  const status = deriveTaskStatus({
    sessionId,
    runningIds,
    compactingIds,
    pendingApprovalIds,
    lastPromptFailed: snapshot?.lastPromptFailed ?? false,
    hasUnreadResult,
    archived,
    isViewing,
  });
  const statusWithStartedAt = {
    ...status,
    ...(snapshot?.startedAt !== undefined ? { startedAt: snapshot.startedAt } : {}),
    ...(snapshot?.goal ? { goal: snapshot.goal } : {}),
  };
  return runtime === "stopping" ? { ...statusWithStartedAt, runtime: "stopping" } : statusWithStartedAt;
}
