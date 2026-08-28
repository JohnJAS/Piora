export type CompanionMotionDirection = "left" | "right";

export interface CompanionMotionRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompanionWalkPlan {
  direction: CompanionMotionDirection;
  startX: number;
  targetX: number;
  distance: number;
  durationMs: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampCompanionBounds(
  bounds: CompanionMotionRectangle,
  workArea: CompanionMotionRectangle,
): CompanionMotionRectangle {
  const maximumX = workArea.x + Math.max(0, workArea.width - bounds.width);
  const maximumY = workArea.y + Math.max(0, workArea.height - bounds.height);
  return {
    ...bounds,
    x: Math.round(clamp(bounds.x, workArea.x, maximumX)),
    y: Math.round(clamp(bounds.y, workArea.y, maximumY)),
  };
}

export function planCompanionWalk(
  bounds: CompanionMotionRectangle,
  workArea: CompanionMotionRectangle,
  requestedDistance: number,
  requestedDurationMs: number,
  preferredDirection?: CompanionMotionDirection,
): CompanionWalkPlan | null {
  const availableLeft = Math.max(0, bounds.x - workArea.x);
  const availableRight = Math.max(0, workArea.x + workArea.width - (bounds.x + bounds.width));
  const direction = preferredDirection === "left" && availableLeft >= 12
    ? "left"
    : preferredDirection === "right" && availableRight >= 12
      ? "right"
      : availableRight >= availableLeft
        ? "right"
        : "left";
  const available = direction === "right" ? availableRight : availableLeft;
  const distance = Math.round(Math.min(clamp(requestedDistance, 24, 360), available));
  if (distance < 12) return null;
  const targetX = bounds.x + (direction === "right" ? distance : -distance);
  return {
    direction,
    startX: bounds.x,
    targetX,
    distance,
    durationMs: Math.round(clamp(requestedDurationMs, 500, 8_000)),
  };
}

export function companionMotionProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  const progress = clamp(elapsedMs / durationMs, 0, 1);
  // A short ease-in/out keeps the OS window from snapping at either end while
  // retaining an almost constant walking speed through the middle.
  return progress * progress * (3 - 2 * progress);
}

export function companionMotionX(plan: CompanionWalkPlan, elapsedMs: number): number {
  const progress = companionMotionProgress(elapsedMs, plan.durationMs);
  return Math.round(plan.startX + (plan.targetX - plan.startX) * progress);
}

export function dragCompanionBounds(
  startingBounds: CompanionMotionRectangle,
  pointerStart: { x: number; y: number },
  pointerCurrent: { x: number; y: number },
  workArea: CompanionMotionRectangle,
): CompanionMotionRectangle {
  return clampCompanionBounds({
    ...startingBounds,
    x: startingBounds.x + pointerCurrent.x - pointerStart.x,
    y: startingBounds.y + pointerCurrent.y - pointerStart.y,
  }, workArea);
}
