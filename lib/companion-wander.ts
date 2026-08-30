import type { CompanionAutonomyLevel } from "./companion-runtime";

export interface CompanionWanderPlan {
  delayMs: number;
  shouldMove: boolean;
  direction: "left" | "right";
  distance: number;
  durationMs: number;
}

const PROFILES: Record<CompanionAutonomyLevel, {
  delay: [number, number];
  distance: [number, number];
  moveChance: number;
  speed: [number, number];
}> = {
  quiet: { delay: [90_000, 180_000], distance: [36, 90], moveChance: 0.38, speed: [36, 52] },
  balanced: { delay: [28_000, 72_000], distance: [54, 180], moveChance: 0.72, speed: [42, 68] },
  active: { delay: [12_000, 40_000], distance: [70, 260], moveChance: 0.9, speed: [52, 82] },
};

function unit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(0.999_999, value));
}

function between([minimum, maximum]: [number, number], random: () => number): number {
  return minimum + (maximum - minimum) * unit(random());
}

export function planCompanionWander(input: {
  autonomyLevel: CompanionAutonomyLevel;
  hasRunningTasks: boolean;
  random?: () => number;
}): CompanionWanderPlan {
  const random = input.random ?? Math.random;
  const profile = PROFILES[input.autonomyLevel];
  const focusSlowdown = input.hasRunningTasks ? 1.35 : 1;
  const moveChance = profile.moveChance * (input.hasRunningTasks ? 0.62 : 1);
  const delayMs = Math.round(between(profile.delay, random) * focusSlowdown);
  const shouldMove = unit(random()) < moveChance;
  const direction = unit(random()) < 0.5 ? "left" : "right";
  const rawDistance = between(profile.distance, random);
  const distance = Math.round(input.hasRunningTasks ? Math.min(rawDistance, 120) : rawDistance);
  const speed = between(profile.speed, random);
  const durationMs = Math.round(Math.max(900, Math.min(5_200, distance / speed * 1_000)));
  return { delayMs, shouldMove, direction, distance, durationMs };
}
