import type { AgentThemeMood, AgentThemeMoodSnapshot } from "./agent-mood-store";
import type { FlagshipVariant } from "./flagship-themes";

export interface FlagshipMoodVisualProfile {
  readonly tempo: number;
  readonly gazeBias: readonly [number, number];
  readonly gazeLock: number;
  readonly squint: number;
  readonly beaconColor: readonly [number, number, number];
  readonly beaconStrength: number;
  readonly beaconPulseHz: number;
  readonly particleEnergy: number;
  readonly ringCount: number;
}

const DAY_PROFILES: Record<AgentThemeMood, FlagshipMoodVisualProfile> = {
  idle: {
    tempo: 1.0,
    gazeBias: [0, 0],
    gazeLock: 0,
    squint: 0,
    beaconColor: [0.32, 0.78, 0.96],
    beaconStrength: 0.22,
    beaconPulseHz: 0.32,
    particleEnergy: 0.24,
    ringCount: 0,
  },
  waiting: {
    tempo: 1.15,
    gazeBias: [-0.62, -0.04],
    gazeLock: 0.45,
    squint: 0.1,
    beaconColor: [0.18, 0.56, 0.98],
    beaconStrength: 0.46,
    beaconPulseHz: 0.78,
    particleEnergy: 0.45,
    ringCount: 1,
  },
  running: {
    tempo: 1.52,
    gazeBias: [-0.52, 0.12],
    gazeLock: 0.5,
    squint: 0.05,
    beaconColor: [0.12, 0.76, 0.96],
    beaconStrength: 0.54,
    beaconPulseHz: 1.35,
    particleEnergy: 0.76,
    ringCount: 1,
  },
  review: {
    tempo: 1.12,
    gazeBias: [0, -0.04],
    gazeLock: 0.85,
    squint: 0,
    beaconColor: [0.96, 0.66, 0.16],
    beaconStrength: 0.64,
    beaconPulseHz: 1.05,
    particleEnergy: 0.52,
    ringCount: 2,
  },
  completed: {
    tempo: 1.25,
    gazeBias: [0.05, -0.08],
    gazeLock: 0.65,
    squint: 0.22,
    beaconColor: [0.2, 0.84, 0.56],
    beaconStrength: 0.58,
    beaconPulseHz: 0.9,
    particleEnergy: 0.68,
    ringCount: 1,
  },
  failed: {
    tempo: 0.75,
    gazeBias: [0, 0.44],
    gazeLock: 0.72,
    squint: 0.34,
    beaconColor: [0.94, 0.34, 0.32],
    beaconStrength: 0.52,
    beaconPulseHz: 0.65,
    particleEnergy: 0.16,
    ringCount: 1,
  },
};

const NIGHT_PROFILES: Record<AgentThemeMood, FlagshipMoodVisualProfile> = {
  idle: {
    tempo: 1.0,
    gazeBias: [0, 0],
    gazeLock: 0,
    squint: 0,
    beaconColor: [0.32, 0.84, 0.98],
    beaconStrength: 0.42,
    beaconPulseHz: 0.32,
    particleEnergy: 0.34,
    ringCount: 0,
  },
  waiting: {
    tempo: 1.15,
    gazeBias: [-0.62, -0.04],
    gazeLock: 0.45,
    squint: 0.1,
    beaconColor: [0.24, 0.64, 1.0],
    beaconStrength: 0.72,
    beaconPulseHz: 0.78,
    particleEnergy: 0.56,
    ringCount: 1,
  },
  running: {
    tempo: 1.52,
    gazeBias: [-0.52, 0.12],
    gazeLock: 0.5,
    squint: 0.05,
    beaconColor: [0.2, 0.88, 1.0],
    beaconStrength: 0.86,
    beaconPulseHz: 1.35,
    particleEnergy: 0.88,
    ringCount: 1,
  },
  review: {
    tempo: 1.12,
    gazeBias: [0, -0.04],
    gazeLock: 0.85,
    squint: 0,
    beaconColor: [0.98, 0.72, 0.24],
    beaconStrength: 0.94,
    beaconPulseHz: 1.05,
    particleEnergy: 0.62,
    ringCount: 2,
  },
  completed: {
    tempo: 1.25,
    gazeBias: [0.05, -0.08],
    gazeLock: 0.65,
    squint: 0.22,
    beaconColor: [0.28, 0.92, 0.64],
    beaconStrength: 0.88,
    beaconPulseHz: 0.9,
    particleEnergy: 0.78,
    ringCount: 1,
  },
  failed: {
    tempo: 0.75,
    gazeBias: [0, 0.44],
    gazeLock: 0.72,
    squint: 0.34,
    beaconColor: [0.96, 0.38, 0.36],
    beaconStrength: 0.82,
    beaconPulseHz: 0.65,
    particleEnergy: 0.22,
    ringCount: 1,
  },
};

export function getFlagshipMoodVisualProfile(
  snapshot: Pick<AgentThemeMoodSnapshot, "mood" | "isBackgroundOnly" | "runningSubagentCount">,
  variant: FlagshipVariant,
): FlagshipMoodVisualProfile {
  const base = (variant === "day" ? DAY_PROFILES : NIGHT_PROFILES)[snapshot.mood];
  const bgStrengthScale = snapshot.isBackgroundOnly ? 0.72 : 1;
  const bgLockScale = snapshot.isBackgroundOnly ? 0.45 : 1;
  const subagentBoost = snapshot.mood === "running" && snapshot.runningSubagentCount > 0 ? 1 : 0;

  return {
    tempo: base.tempo,
    gazeBias: base.gazeBias,
    gazeLock: base.gazeLock * bgLockScale,
    squint: base.squint,
    beaconColor: base.beaconColor,
    beaconStrength: base.beaconStrength * bgStrengthScale,
    beaconPulseHz: base.beaconPulseHz,
    particleEnergy: base.particleEnergy * (snapshot.isBackgroundOnly ? 0.82 : 1),
    ringCount: Math.min(2, base.ringCount + subagentBoost),
  };
}

export interface MoodMotionState {
  tempo: number;
  gazeX: number;
  gazeY: number;
  gazeLock: number;
  squint: number;
  colorR: number;
  colorG: number;
  colorB: number;
  beaconStrength: number;
  beaconPulseHz: number;
  particleEnergy: number;
  ringCount: number;
  pulsePhase: number;
}

export function createMoodMotionState(variant: FlagshipVariant = "night"): MoodMotionState {
  const initial = (variant === "day" ? DAY_PROFILES : NIGHT_PROFILES).idle;
  return {
    tempo: initial.tempo,
    gazeX: initial.gazeBias[0],
    gazeY: initial.gazeBias[1],
    gazeLock: initial.gazeLock,
    squint: initial.squint,
    colorR: initial.beaconColor[0],
    colorG: initial.beaconColor[1],
    colorB: initial.beaconColor[2],
    beaconStrength: initial.beaconStrength,
    beaconPulseHz: initial.beaconPulseHz,
    particleEnergy: initial.particleEnergy,
    ringCount: initial.ringCount,
    pulsePhase: 0,
  };
}

export function stepMoodMotionState(
  state: MoodMotionState,
  snapshot: Pick<AgentThemeMoodSnapshot, "mood" | "isBackgroundOnly" | "runningSubagentCount">,
  variant: FlagshipVariant,
  deltaSeconds: number,
): MoodMotionState {
  const target = getFlagshipMoodVisualProfile(snapshot, variant);
  const dt = Math.max(0, Math.min(0.25, deltaSeconds));
  const fast = 1 - Math.exp(-dt * 5.2);
  const medium = 1 - Math.exp(-dt * 3.8);
  const gentle = 1 - Math.exp(-dt * 2.6);

  state.tempo += (target.tempo - state.tempo) * gentle;
  state.gazeX += (target.gazeBias[0] - state.gazeX) * fast;
  state.gazeY += (target.gazeBias[1] - state.gazeY) * fast;
  state.gazeLock += (target.gazeLock - state.gazeLock) * medium;
  state.squint += (target.squint - state.squint) * fast;
  state.colorR += (target.beaconColor[0] - state.colorR) * medium;
  state.colorG += (target.beaconColor[1] - state.colorG) * medium;
  state.colorB += (target.beaconColor[2] - state.colorB) * medium;
  state.beaconStrength += (target.beaconStrength - state.beaconStrength) * medium;
  state.beaconPulseHz += (target.beaconPulseHz - state.beaconPulseHz) * gentle;
  state.particleEnergy += (target.particleEnergy - state.particleEnergy) * gentle;
  state.ringCount += (target.ringCount - state.ringCount) * medium;
  state.pulsePhase += dt * state.beaconPulseHz * Math.PI * 2;
  return state;
}
