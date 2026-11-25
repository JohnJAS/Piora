import type { CompanionActivity } from "../companion";
import type { TaskRuntimeSnapshot } from "../task-status";

export type AgentThemeMood =
  | "idle"
  | "waiting"
  | "running"
  | "review"
  | "completed"
  | "failed";

export type AgentMoodPulseKind = "started" | "completed" | "failed" | "review";

export interface AgentThemeMoodSnapshot {
  readonly mood: AgentThemeMood;
  readonly liveMood: AgentThemeMood;
  readonly previewMood: AgentThemeMood | null;
  readonly activeTaskCount: number;
  readonly runningSubagentCount: number;
  readonly isBackgroundOnly: boolean;
  readonly pulseKey: string | null;
  readonly pulseKind: AgentMoodPulseKind | null;
  readonly pulseAt: number;
}

export interface AgentMoodInput {
  readonly currentActivity: CompanionActivity;
  readonly runningTasks: readonly TaskRuntimeSnapshot[];
  readonly activeSessionId?: string | null;
}

export interface ResolveRawAgentMoodInput extends AgentMoodInput {
  readonly now: number;
  readonly lastCompletedAt: number;
  readonly lastFailedAt: number;
}

export interface RawAgentMoodResolution {
  readonly mood: AgentThemeMood;
  readonly isBackgroundOnly: boolean;
  readonly activeTaskCount: number;
  readonly runningSubagentCount: number;
}

export const COMPLETED_HOLD_MS = 2_800;
export const FAILED_HOLD_MS = 4_500;
export const WORK_SWITCH_DEBOUNCE_MS = 380;
export const MIN_WORK_DWELL_MS = 900;
export const IDLE_SETTLE_DELAY_MS = 450;

function isTaskAwaitingApproval(task: TaskRuntimeSnapshot): boolean {
  return task.pendingApproval
    || task.awaitingPlanApproval === true
    || task.taskRun?.phase === "waiting_approval";
}

function isTaskActiveRuntime(task: TaskRuntimeSnapshot): boolean {
  return task.runtime === "running"
    || task.runtime === "compacting"
    || task.runtime === "stopping";
}

function isRecentTimestamp(timestamp: number, now: number, windowMs: number): boolean {
  return Number.isFinite(timestamp)
    && timestamp > 0
    && now >= timestamp
    && now - timestamp < windowMs;
}

export function resolveRawAgentMood(input: ResolveRawAgentMoodInput): RawAgentMoodResolution {
  const { currentActivity, runningTasks, activeSessionId, now, lastCompletedAt, lastFailedAt } = input;

  const activeSessionIds = new Set<string>();
  let runningSubagentCount = 0;
  for (const task of runningTasks) {
    if (isTaskActiveRuntime(task) || isTaskAwaitingApproval(task)) {
      activeSessionIds.add(task.id);
    }
    if (typeof task.runningSubagentCount === "number" && task.runningSubagentCount > 0) {
      runningSubagentCount += task.runningSubagentCount;
    }
  }
  const currentActive = currentActivity.status === "running"
    || currentActivity.status === "waiting"
    || currentActivity.status === "review";
  const currentId = activeSessionId || currentActivity.sessionId;
  if (currentActive && currentId) activeSessionIds.add(currentId);
  const activeTaskCount = currentActive && activeSessionIds.size === 0 ? 1 : activeSessionIds.size;

  // Priority 1: Current chat explicitly awaits approval / user review.
  if (currentActivity.status === "review") {
    return { mood: "review", isBackgroundOnly: false, activeTaskCount, runningSubagentCount };
  }

  // Priority 2: Any background session awaits approval.
  if (runningTasks.some(isTaskAwaitingApproval)) {
    return { mood: "review", isBackgroundOnly: true, activeTaskCount, runningSubagentCount };
  }

  // Priority 3: Current chat recently failed (auto-clears after FAILED_HOLD_MS).
  if (currentActivity.status === "failed" && isRecentTimestamp(lastFailedAt, now, FAILED_HOLD_MS)) {
    return { mood: "failed", isBackgroundOnly: false, activeTaskCount, runningSubagentCount };
  }

  // Priority 4 & 5: Current chat active work states.
  if (currentActivity.status === "running") {
    return { mood: "running", isBackgroundOnly: false, activeTaskCount, runningSubagentCount };
  }
  if (currentActivity.status === "waiting") {
    return { mood: "waiting", isBackgroundOnly: false, activeTaskCount, runningSubagentCount };
  }

  // Priority 6: Recent completion pulse window.
  if (isRecentTimestamp(lastCompletedAt, now, COMPLETED_HOLD_MS)) {
    return { mood: "completed", isBackgroundOnly: false, activeTaskCount, runningSubagentCount };
  }

  // Priority 7: Background running / compacting tasks.
  const backgroundActive = runningTasks.filter(isTaskActiveRuntime);
  if (backgroundActive.length > 0) {
    const allThinkingOrPrompt = backgroundActive.every(
      (task) => task.activity?.kind === "thinking" || task.activity?.kind === "prompt",
    );
    const isBackgroundOnly = !activeSessionId
      || backgroundActive.some((task) => task.id !== activeSessionId);
    return {
      mood: allThinkingOrPrompt ? "waiting" : "running",
      isBackgroundOnly,
      activeTaskCount,
      runningSubagentCount,
    };
  }

  // Priority 8: Calm idle default.
  return { mood: "idle", isBackgroundOnly: false, activeTaskCount, runningSubagentCount };
}

export interface AgentMoodControllerOptions {
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

function isUrgentMood(mood: AgentThemeMood): boolean {
  return mood === "review" || mood === "completed" || mood === "failed";
}

function isWorkMood(mood: AgentThemeMood): boolean {
  return mood === "running" || mood === "waiting";
}

const INITIAL_SNAPSHOT: AgentThemeMoodSnapshot = Object.freeze({
  mood: "idle",
  liveMood: "idle",
  previewMood: null,
  activeTaskCount: 0,
  runningSubagentCount: 0,
  isBackgroundOnly: false,
  pulseKey: null,
  pulseKind: null,
  pulseAt: 0,
});

export function createAgentMoodController(options: AgentMoodControllerOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const scheduleTimer = options.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const cancelTimer = options.clearTimer ?? ((handle: unknown) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  });

  const listeners = new Set<() => void>();
  let snapshot: AgentThemeMoodSnapshot = INITIAL_SNAPSHOT;
  let lastInput: AgentMoodInput | null = null;
  let lastStatus: CompanionActivity["status"] = "idle";
  let lastEventKey: string | null = null;
  let lastCompletedAt = -Infinity;
  let lastFailedAt = -Infinity;
  let lastWorkChangedAt = -Infinity;
  let previewSequence = 0;
  let reviewSequence = 0;

  let pendingTransition: { mood: AgentThemeMood; isBackgroundOnly: boolean; timer: unknown } | null = null;
  let holdTimer: unknown = null;

  function emit(): void {
    listeners.forEach((listener) => listener());
  }

  function clearPendingTransition(): void {
    if (!pendingTransition) return;
    cancelTimer(pendingTransition.timer);
    pendingTransition = null;
  }

  function clearHoldTimer(): void {
    if (holdTimer === null) return;
    cancelTimer(holdTimer);
    holdTimer = null;
  }

  function commitSnapshot(next: Partial<AgentThemeMoodSnapshot>): void {
    const liveMood = next.liveMood ?? snapshot.liveMood;
    const previewMood = "previewMood" in next ? (next.previewMood ?? null) : snapshot.previewMood;
    const mood = previewMood ?? liveMood;
    const candidate: AgentThemeMoodSnapshot = Object.freeze({
      mood,
      liveMood,
      previewMood,
      activeTaskCount: next.activeTaskCount ?? snapshot.activeTaskCount,
      runningSubagentCount: next.runningSubagentCount ?? snapshot.runningSubagentCount,
      isBackgroundOnly: next.isBackgroundOnly ?? snapshot.isBackgroundOnly,
      pulseKey: "pulseKey" in next ? (next.pulseKey ?? null) : snapshot.pulseKey,
      pulseKind: "pulseKind" in next ? (next.pulseKind ?? null) : snapshot.pulseKind,
      pulseAt: next.pulseAt ?? snapshot.pulseAt,
    });
    if (
      candidate.mood === snapshot.mood
      && candidate.liveMood === snapshot.liveMood
      && candidate.previewMood === snapshot.previewMood
      && candidate.activeTaskCount === snapshot.activeTaskCount
      && candidate.runningSubagentCount === snapshot.runningSubagentCount
      && candidate.isBackgroundOnly === snapshot.isBackgroundOnly
      && candidate.pulseKey === snapshot.pulseKey
      && candidate.pulseKind === snapshot.pulseKind
      && candidate.pulseAt === snapshot.pulseAt
    ) {
      return;
    }
    snapshot = candidate;
    emit();
  }

  function scheduleHoldReevaluation(delayMs: number): void {
    clearHoldTimer();
    holdTimer = scheduleTimer(() => {
      holdTimer = null;
      if (lastInput) evaluate(lastInput);
    }, delayMs);
  }

  function applyLiveMood(
    nextMood: AgentThemeMood,
    resolution: RawAgentMoodResolution,
    pulseUpdate?: { pulseKey: string; pulseKind: AgentMoodPulseKind; pulseAt: number },
  ): void {
    const previousLive = snapshot.liveMood;
    const currentTime = now();
    if (isWorkMood(nextMood) && nextMood !== previousLive) {
      lastWorkChangedAt = currentTime;
    }
    let pulse = pulseUpdate;
    if (!pulse && nextMood === "review" && previousLive !== "review") {
      pulse = {
        pulseKey: `review:${++reviewSequence}`,
        pulseKind: "review",
        pulseAt: currentTime,
      };
    }

    commitSnapshot({
      liveMood: nextMood,
      activeTaskCount: resolution.activeTaskCount,
      runningSubagentCount: resolution.runningSubagentCount,
      isBackgroundOnly: resolution.isBackgroundOnly,
      ...(pulse ?? {}),
    });

    if (nextMood === "completed") {
      const remaining = Math.max(1, COMPLETED_HOLD_MS - (currentTime - lastCompletedAt));
      scheduleHoldReevaluation(remaining);
    } else if (nextMood === "failed") {
      const remaining = Math.max(1, FAILED_HOLD_MS - (currentTime - lastFailedAt));
      scheduleHoldReevaluation(remaining);
    } else {
      clearHoldTimer();
    }
  }

  function evaluate(input: AgentMoodInput, pulseUpdate?: { pulseKey: string; pulseKind: AgentMoodPulseKind; pulseAt: number }): void {
    const currentTime = now();
    const resolution = resolveRawAgentMood({
      ...input,
      now: currentTime,
      lastCompletedAt,
      lastFailedAt,
    });
    const rawMood = resolution.mood;
    const currentLive = snapshot.liveMood;

    if (rawMood === currentLive) {
      clearPendingTransition();
      commitSnapshot({
        activeTaskCount: resolution.activeTaskCount,
        runningSubagentCount: resolution.runningSubagentCount,
        isBackgroundOnly: resolution.isBackgroundOnly,
        ...(pulseUpdate ?? {}),
      });
      return;
    }

    // Immediate transitions:
    // 1. Urgent moods (review, completed, failed)
    // 2. Entering active work from idle / completed / failed
    // 3. Leaving urgent moods back to live work/idle
    if (isUrgentMood(rawMood) || !isWorkMood(currentLive)) {
      clearPendingTransition();
      applyLiveMood(rawMood, resolution, pulseUpdate);
      return;
    }

    // Work <-> work oscillation hysteresis
    if (isWorkMood(currentLive) && isWorkMood(rawMood)) {
      const elapsedSinceSwitch = currentTime - lastWorkChangedAt;
      const delayMs = Math.max(WORK_SWITCH_DEBOUNCE_MS, MIN_WORK_DWELL_MS - elapsedSinceSwitch);
      commitSnapshot({
        activeTaskCount: resolution.activeTaskCount,
        runningSubagentCount: resolution.runningSubagentCount,
        isBackgroundOnly: resolution.isBackgroundOnly,
        ...(pulseUpdate ?? {}),
      });
      if (pendingTransition?.mood === rawMood) return;
      clearPendingTransition();
      const timer = scheduleTimer(() => {
        pendingTransition = null;
        if (!lastInput) return;
        const latest = resolveRawAgentMood({
          ...lastInput,
          now: now(),
          lastCompletedAt,
          lastFailedAt,
        });
        applyLiveMood(latest.mood, latest);
      }, delayMs);
      pendingTransition = { mood: rawMood, isBackgroundOnly: resolution.isBackgroundOnly, timer };
      return;
    }

    // Settling from running / waiting -> idle
    if (isWorkMood(currentLive) && rawMood === "idle") {
      commitSnapshot({
        activeTaskCount: resolution.activeTaskCount,
        runningSubagentCount: resolution.runningSubagentCount,
        isBackgroundOnly: resolution.isBackgroundOnly,
        ...(pulseUpdate ?? {}),
      });
      if (pendingTransition?.mood === "idle") return;
      clearPendingTransition();
      const timer = scheduleTimer(() => {
        pendingTransition = null;
        if (!lastInput) return;
        const latest = resolveRawAgentMood({
          ...lastInput,
          now: now(),
          lastCompletedAt,
          lastFailedAt,
        });
        applyLiveMood(latest.mood, latest);
      }, IDLE_SETTLE_DELAY_MS);
      pendingTransition = { mood: "idle", isBackgroundOnly: false, timer };
      return;
    }

    clearPendingTransition();
    applyLiveMood(rawMood, resolution, pulseUpdate);
  }

  function publish(input: AgentMoodInput): void {
    const currentTime = now();
    const { currentActivity } = input;
    let pulseUpdate: { pulseKey: string; pulseKind: AgentMoodPulseKind; pulseAt: number } | undefined;

    if (currentActivity.event && currentActivity.event.key !== lastEventKey) {
      lastEventKey = currentActivity.event.key;
      const kind = currentActivity.event.kind;
      if (kind === "completed") {
        lastCompletedAt = currentTime;
        lastFailedAt = -Infinity;
        pulseUpdate = { pulseKey: currentActivity.event.key, pulseKind: "completed", pulseAt: currentTime };
      } else if (kind === "failed") {
        lastFailedAt = currentTime;
        lastCompletedAt = -Infinity;
        pulseUpdate = { pulseKey: currentActivity.event.key, pulseKind: "failed", pulseAt: currentTime };
      } else if (kind === "started") {
        lastCompletedAt = -Infinity;
        lastFailedAt = -Infinity;
        pulseUpdate = { pulseKey: currentActivity.event.key, pulseKind: "started", pulseAt: currentTime };
      }
    } else if (currentActivity.status === "failed" && lastStatus !== "failed") {
      lastFailedAt = currentTime;
      lastCompletedAt = -Infinity;
      pulseUpdate = { pulseKey: `failed:${currentTime}:${++previewSequence}`, pulseKind: "failed", pulseAt: currentTime };
    } else if (currentActivity.status === "running" || currentActivity.status === "waiting") {
      lastCompletedAt = -Infinity;
      lastFailedAt = -Infinity;
    }

    lastStatus = currentActivity.status;
    lastInput = input;
    evaluate(input, pulseUpdate);
  }

  function setPreviewMood(mood: AgentThemeMood | null): void {
    const currentTime = now();
    if (mood === null) {
      commitSnapshot({ previewMood: null });
      return;
    }
    const pulseKind: AgentMoodPulseKind | null =
      mood === "running" ? "started"
      : mood === "review" ? "review"
      : mood === "completed" ? "completed"
      : mood === "failed" ? "failed"
      : null;
    commitSnapshot({
      previewMood: mood,
      ...(pulseKind ? {
        pulseKey: `preview:${mood}:${++previewSequence}`,
        pulseKind,
        pulseAt: currentTime,
      } : {}),
    });
  }

  function getSnapshot(): AgentThemeMoodSnapshot {
    return snapshot;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function reset(): void {
    clearPendingTransition();
    clearHoldTimer();
    lastInput = null;
    lastStatus = "idle";
    lastEventKey = null;
    lastCompletedAt = -Infinity;
    lastFailedAt = -Infinity;
    lastWorkChangedAt = -Infinity;
    snapshot = INITIAL_SNAPSHOT;
    emit();
  }

  function dispose(): void {
    clearPendingTransition();
    clearHoldTimer();
    listeners.clear();
  }

  return {
    publish,
    setPreviewMood,
    getSnapshot,
    subscribe,
    reset,
    dispose,
  };
}

const sharedStore = createAgentMoodController();

export function publishAgentThemeMood(input: AgentMoodInput): void {
  sharedStore.publish(input);
}

export function setAgentMoodPreview(mood: AgentThemeMood | null): void {
  sharedStore.setPreviewMood(mood);
}

export function getAgentThemeMoodSnapshot(): AgentThemeMoodSnapshot {
  return sharedStore.getSnapshot();
}

export function subscribeAgentThemeMood(listener: () => void): () => void {
  return sharedStore.subscribe(listener);
}

export function resetAgentThemeMoodStore(): void {
  sharedStore.reset();
}
