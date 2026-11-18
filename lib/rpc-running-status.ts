import type { AgentSessionWrapper } from "./rpc-manager";
import type { TaskRuntimeSnapshot } from "./task-status";

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piRunningListeners: Set<(sessions: TaskRuntimeSnapshot[]) => void> | undefined;
  var __piRunningNotifyTimer: ReturnType<typeof setTimeout> | undefined;
}

export function getRunningRpcSessionIds(): string[] {
  return getRunningRpcSessionStatuses()
    .filter((session) => session.runtime !== "idle")
    .map((session) => session.id);
}

export function getRunningRpcSessionStatuses(includeIdle = false): TaskRuntimeSnapshot[] {
  const statuses: TaskRuntimeSnapshot[] = [];
  for (const session of globalThis.__piSessions?.values() ?? []) {
    if (!session.isAlive() || session.isSubagentSession?.()) continue;
    // globalThis deliberately retains wrappers across Next.js hot reloads.
    // A wrapper created by the previous module version does not yet have the
    // three-axis accessor, so adapt it until that live session is recreated.
    const snapshot = typeof session.getTaskRuntimeSnapshot === "function"
      ? session.getTaskRuntimeSnapshot()
      : {
          id: session.sessionId,
          runtime: session.inner.isCompacting ? "compacting" as const : session.isRunning() ? "running" as const : "idle" as const,
          pendingApproval: false,
          lastPromptFailed: false,
        };
    const hasOpenTaskRun = snapshot.taskRun
      && snapshot.taskRun.phase !== "completed"
      && snapshot.taskRun.phase !== "cancelled";
    if (includeIdle || snapshot.runtime !== "idle" || snapshot.pendingApproval || snapshot.lastPromptFailed || hasOpenTaskRun) {
      statuses.push(snapshot);
    }
  }
  return statuses.sort((left, right) => left.id.localeCompare(right.id));
}

/** Subscribe to running-session-id changes. Returns an unsubscribe function. */
export function subscribeRunningSessions(listener: (sessions: TaskRuntimeSnapshot[]) => void): () => void {
  const listeners = globalThis.__piRunningListeners ??= new Set();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let lastRunningSnapshot = "";
const RUNNING_SNAPSHOT_THROTTLE_MS = 250;

export function scheduleRunningChange(): void {
  if (globalThis.__piRunningNotifyTimer) return;
  globalThis.__piRunningNotifyTimer = setTimeout(() => {
    globalThis.__piRunningNotifyTimer = undefined;
    notifyRunningChange();
  }, RUNNING_SNAPSHOT_THROTTLE_MS);
}

/**
 * Recompute the running-session-id set and, if it changed since the last
 * notification, broadcast it to subscribers. Cheap to call often.
 */
export function notifyRunningChange(): void {
  if (globalThis.__piRunningNotifyTimer) {
    clearTimeout(globalThis.__piRunningNotifyTimer);
    globalThis.__piRunningNotifyTimer = undefined;
  }
  const sessions = getRunningRpcSessionStatuses();
  const snapshot = JSON.stringify(sessions);
  if (snapshot === lastRunningSnapshot) return;
  lastRunningSnapshot = snapshot;
  for (const listener of globalThis.__piRunningListeners ?? []) {
    try { listener(sessions); } catch { /* ignore listener errors */ }
  }
}
