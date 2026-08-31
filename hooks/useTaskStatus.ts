"use client";

import { useCallback, useSyncExternalStore } from "react";
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
const snapshotSignatures = new Map<string, string>();
const sessionListeners = new Map<string, Set<() => void>>();
const storeListeners = new Set<() => void>();
let runtimeStoreState: { ready: boolean; snapshots: TaskRuntimeSnapshot[] } = { ready: false, snapshots: [] };
let eventSource: EventSource | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityBound = false;

function listenerCount(): number {
  let count = storeListeners.size;
  for (const listeners of sessionListeners.values()) count += listeners.size;
  return count;
}

function emitChange(changedSessionIds: Set<string>): void {
  for (const sessionId of changedSessionIds) {
    for (const listener of sessionListeners.get(sessionId) ?? []) listener();
  }
  for (const listener of storeListeners) listener();
}

function applyPayload(payload: Partial<RunningSessionsPayload>): void {
  const incoming = new Map<string, TaskRuntimeSnapshot>();
  if (Array.isArray(payload.runningSessions)) {
    for (const session of payload.runningSessions) {
      if (!session || typeof session.id !== "string") continue;
      incoming.set(session.id, session);
    }
  } else {
    for (const id of payload.runningSessionIds ?? []) {
      incoming.set(id, {
        id,
        runtime: "running",
        pendingApproval: false,
        lastPromptFailed: false,
      });
    }
  }

  const changedSessionIds = new Set<string>();
  const next = new Map<string, TaskRuntimeSnapshot>();
  const nextSignatures = new Map<string, string>();
  for (const [id, snapshot] of incoming) {
    const signature = JSON.stringify(snapshot);
    nextSignatures.set(id, signature);
    if (snapshotSignatures.get(id) === signature) {
      next.set(id, runtimeBySession.get(id) ?? snapshot);
    } else {
      next.set(id, snapshot);
      changedSessionIds.add(id);
    }
  }
  for (const id of runtimeBySession.keys()) {
    if (!next.has(id)) changedSessionIds.add(id);
  }
  if (runtimeStoreState.ready && changedSessionIds.size === 0) return;

  runtimeBySession.clear();
  for (const [id, session] of next) runtimeBySession.set(id, session);
  snapshotSignatures.clear();
  for (const [id, signature] of nextSignatures) snapshotSignatures.set(id, signature);
  runtimeStoreState = {
    ready: true,
    snapshots: [...runtimeBySession.values()].sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0)),
  };
  emitChange(changedSessionIds);
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
  if (pollTimer !== null || listenerCount() === 0) return;
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollSnapshot().finally(() => {
      if (eventSource?.readyState !== EventSource.OPEN) scheduleFallbackPoll();
    });
  }, 2_500);
}

function stopFallbackPoll(): void {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
}

function connect(): void {
  if (typeof window === "undefined" || eventSource || listenerCount() === 0) return;
  void pollSnapshot();
  eventSource = new EventSource("/api/agent/running/events");
  eventSource.onopen = stopFallbackPoll;
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
  if (listenerCount() > 0) return;
  eventSource?.close();
  eventSource = null;
  stopFallbackPoll();
  if (visibilityBound) {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    visibilityBound = false;
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible") void pollSnapshot();
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);
  connect();
  return () => {
    storeListeners.delete(listener);
    disconnect();
  };
}

function subscribeSession(sessionId: string, listener: () => void): () => void {
  const listeners = sessionListeners.get(sessionId) ?? new Set<() => void>();
  listeners.add(listener);
  sessionListeners.set(sessionId, listeners);
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) sessionListeners.delete(sessionId);
    disconnect();
  };
}

function getRuntimeStoreState(): typeof runtimeStoreState {
  return runtimeStoreState;
}

export function useRunningTaskSnapshots(): TaskRuntimeSnapshot[] {
  return useSyncExternalStore(subscribeStore, getRuntimeStoreState, getRuntimeStoreState).snapshots;
}

export function useRunningTaskRuntimeState(): typeof runtimeStoreState {
  return useSyncExternalStore(subscribeStore, getRuntimeStoreState, getRuntimeStoreState);
}

export function useTaskStatus({
  sessionId,
  archived = false,
  isViewing = false,
  hasUnreadResult = false,
  fallbackRuntime = "idle",
}: UseTaskStatusOptions): TaskStatus {
  const subscribe = useCallback(
    (listener: () => void) => subscribeSession(sessionId, listener),
    [sessionId],
  );
  const getSnapshot = useCallback(() => runtimeBySession.get(sessionId) ?? null, [sessionId]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => null);
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
    taskRun: snapshot?.taskRun,
  });
  const statusWithStartedAt = {
    ...status,
    ...(snapshot?.startedAt !== undefined ? { startedAt: snapshot.startedAt } : {}),
  };
  return runtime === "stopping" ? { ...statusWithStartedAt, runtime: "stopping" } : statusWithStartedAt;
}
