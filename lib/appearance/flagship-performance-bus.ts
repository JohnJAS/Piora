export type FlagshipPerformanceId = "celebrate" | "salute";
export type FlagshipPerformancePhase = "idle" | "settling" | "playing";

export interface FlagshipPerformanceRequest {
  readonly clipId: FlagshipPerformanceId | "stop";
  readonly seq: number;
}

export interface FlagshipPerformanceBusState {
  readonly activeClipId: FlagshipPerformanceId | null;
  readonly phase: FlagshipPerformancePhase;
  readonly lastRequest: FlagshipPerformanceRequest | null;
}

const INITIAL_STATE: FlagshipPerformanceBusState = Object.freeze({
  activeClipId: null,
  phase: "idle",
  lastRequest: null,
});

const listeners = new Set<() => void>();
let state: FlagshipPerformanceBusState = INITIAL_STATE;
let nextSeq = 0;

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function requestFlagshipPerformance(clipId: FlagshipPerformanceId | "stop"): void {
  nextSeq += 1;
  state = Object.freeze({
    ...state,
    lastRequest: Object.freeze({ clipId, seq: nextSeq }),
  });
  emit();
}

export function setFlagshipPerformanceStatus(
  activeClipId: FlagshipPerformanceId | null,
  phase: FlagshipPerformancePhase,
): void {
  if (state.activeClipId === activeClipId && state.phase === phase) return;
  state = Object.freeze({
    ...state,
    activeClipId,
    phase,
  });
  emit();
}

export function getFlagshipPerformanceBusSnapshot(): FlagshipPerformanceBusState {
  return state;
}

export function subscribeFlagshipPerformanceBus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetFlagshipPerformanceBus(): void {
  nextSeq = 0;
  state = INITIAL_STATE;
  emit();
}
