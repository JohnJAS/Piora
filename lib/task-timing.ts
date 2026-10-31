import type { SessionCommandStatus } from "./session-message-types";

/** One dispatched task, including model/tool/retry/approval time, excluding queue time. */
export interface TaskTiming {
  commandId: string;
  sessionId: string;
  startedAt: number;
  finishedAt?: number;
  outcome?: "completed" | "failed" | "cancelled" | "interrupted";
}

export function transitionTaskTiming(
  command: { commandId: string; targetSessionId: string; delivery: string; taskTiming?: TaskTiming | null },
  status: SessionCommandStatus,
  now: number,
): TaskTiming | undefined {
  if (command.delivery !== "next_turn") return undefined;
  const previous = command.taskTiming;
  if (previous?.outcome) return previous;
  // Admission can be returned to the queue without ever starting model work.
  if (status === "queued") return undefined;
  if (!previous) return status === "dispatching" || status === "running" ? {
    commandId: command.commandId, sessionId: command.targetSessionId, startedAt: now,
  } : undefined;
  if (status === "interrupted") return { ...previous, outcome: "interrupted" };
  if (status === "completed" || status === "failed" || status === "cancelled") {
    return { ...previous, finishedAt: Math.max(previous.startedAt, now), outcome: status };
  }
  return previous;
}

/** Ignore stale reconciliation responses and never reopen a settled timer. */
export function mergeTaskTiming(current: TaskTiming | null, incoming: TaskTiming | null): TaskTiming | null {
  if (!incoming) return current;
  if (!current || current.sessionId !== incoming.sessionId) return incoming;
  if (current.commandId === incoming.commandId) {
    if (incoming.startedAt < current.startedAt || (current.outcome && !incoming.outcome)) return current;
    return incoming;
  }
  return incoming.startedAt >= current.startedAt ? incoming : current;
}

export function latestTaskTiming(records: Array<{ taskTiming?: TaskTiming | null }>): TaskTiming | null {
  return records.reduce<TaskTiming | null>((current, record) => mergeTaskTiming(current, record.taskTiming ?? null), null);
}

export function taskElapsedMs(timing: TaskTiming, now: number): number | null {
  // A process crash has no trustworthy finish time. Never count offline time.
  if (timing.outcome && timing.finishedAt === undefined) return null;
  return Math.max(0, (timing.finishedAt ?? now) - timing.startedAt);
}
