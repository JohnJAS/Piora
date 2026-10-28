import assert from "node:assert/strict";
import test from "node:test";
import { runInParallel } from "../scripts/verify-preview-artifacts.mjs";

test("preview verification runs independent branches together and awaits both", async () => {
  const started = [];
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const result = runInParallel([
    async () => { started.push("package"); await wait; started.push("package done"); },
    async () => { started.push("installer"); release(); started.push("installer done"); },
  ]);
  await result;
  assert.deepEqual(started.slice(0, 2), ["package", "installer"]);
  assert.ok(started.includes("package done") && started.includes("installer done"));
});

test("a failing branch never hides failures or abandons the other branch", async () => {
  let completed = false;
  await assert.rejects(runInParallel([
    async () => { throw new Error("packaged service failed"); },
    async () => { await Promise.resolve(); completed = true; },
  ]), error => error instanceof AggregateError && error.errors.some(failure => /packaged service failed/.test(failure.message)));
  assert.equal(completed, true);
  await assert.rejects(runInParallel([
    async () => { throw new Error("one"); },
    async () => { throw new Error("two"); },
  ]), error => error instanceof AggregateError && error.errors.length === 2);
});
