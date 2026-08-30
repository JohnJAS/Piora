import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const wander = await jiti.import("./companion-wander.ts");

function sequence(...values) {
  let index = 0;
  return () => values[index++] ?? 0.5;
}

test("companion wander varies timing, direction, distance, and speed deterministically", () => {
  const plan = wander.planCompanionWander({
    autonomyLevel: "balanced",
    hasRunningTasks: false,
    random: sequence(0.5, 0.2, 0.8, 0.5, 0.5),
  });
  assert.deepEqual(plan, {
    delayMs: 50_000,
    shouldMove: true,
    direction: "right",
    distance: 117,
    durationMs: 2_127,
  });
});

test("companion wander becomes quieter and takes shorter walks during active work", () => {
  const idle = wander.planCompanionWander({
    autonomyLevel: "active",
    hasRunningTasks: false,
    random: sequence(0, 0.5, 0.1, 0.999, 0.5),
  });
  const working = wander.planCompanionWander({
    autonomyLevel: "active",
    hasRunningTasks: true,
    random: sequence(0, 0.5, 0.1, 0.999, 0.5),
  });
  assert.equal(idle.delayMs, 12_000);
  assert.equal(working.delayMs, 16_200);
  assert.equal(idle.shouldMove, true);
  assert.equal(working.shouldMove, true);
  assert.equal(working.distance, 120);
  assert.ok(working.distance < idle.distance);
});

test("companion wander sometimes consciously stays put", () => {
  const plan = wander.planCompanionWander({
    autonomyLevel: "quiet",
    hasRunningTasks: false,
    random: sequence(0.5, 0.9, 0.2, 0.5, 0.5),
  });
  assert.equal(plan.shouldMove, false);
  assert.equal(plan.direction, "left");
});
