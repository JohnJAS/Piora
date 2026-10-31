import assert from "node:assert/strict";
import test from "node:test";
import { transitionTaskTiming, mergeTaskTiming, latestTaskTiming, taskElapsedMs } from "./task-timing.ts";

const command = { commandId: "one", targetSessionId: "chat-a", delivery: "next_turn" };
test("task clock excludes queueing and preserves its origin across phases and retries", () => {
  assert.equal(transitionTaskTiming(command, "queued", 10), undefined);
  const start = transitionTaskTiming(command, "dispatching", 1000);
  assert.equal(start.startedAt, 1000);
  let taskTiming = start;
  for (const status of ["delivered", "running", "running"]) {
    taskTiming = transitionTaskTiming({ ...command, taskTiming }, status, 6000);
    assert.equal(taskTiming.startedAt, 1000);
  }
  assert.equal(taskElapsedMs(taskTiming, 84000), 83000);
  const end = transitionTaskTiming({ ...command, taskTiming }, "completed", 85000);
  assert.equal(taskElapsedMs(end, 999999), 84000);
  assert.deepEqual(transitionTaskTiming({ ...command, taskTiming: end }, "completed", 999999), end);
});
test("steering cannot replace the owner timer; rejected admission resets queue time", () => {
  const taskTiming = transitionTaskTiming(command, "dispatching", 1000);
  assert.equal(transitionTaskTiming({ ...command, delivery: "steer" }, "dispatching", 5000), undefined);
  assert.equal(transitionTaskTiming({ ...command, taskTiming }, "queued", 5000), undefined);
  assert.equal(transitionTaskTiming(command, "dispatching", 10000).startedAt, 10000);
});
test("stop, failure, crash and legacy records never invent a completion", () => {
  const taskTiming = transitionTaskTiming(command, "running", 1000);
  for (const status of ["cancelled", "failed"]) {
    const end = transitionTaskTiming({ ...command, taskTiming }, status, 5000);
    assert.equal(end.outcome, status);
    assert.equal(taskElapsedMs(end, 100000), 4000);
  }
  const interrupted = transitionTaskTiming({ ...command, taskTiming }, "interrupted", 999999);
  assert.equal(taskElapsedMs(interrupted, 999999), null);
  assert.equal(transitionTaskTiming(command, "completed", 10000), undefined);
  assert.equal(taskElapsedMs(taskTiming, 500), 0);
});
test("late responses cannot revive old tasks or reopen a completed timer", () => {
  const first = transitionTaskTiming(command, "running", 1000);
  const end = transitionTaskTiming({ ...command, taskTiming: first }, "completed", 2000);
  const next = transitionTaskTiming({ ...command, commandId: "two" }, "running", 3000);
  assert.deepEqual(mergeTaskTiming(end, first), end);
  assert.deepEqual(mergeTaskTiming(next, end), next);
  assert.deepEqual(latestTaskTiming([{ taskTiming: next }, { taskTiming: end }]), next);
  assert.equal(latestTaskTiming([{}, {}]), null);
  const other = { ...first, sessionId: "chat-b" };
  assert.deepEqual(mergeTaskTiming(next, other), other);
});
