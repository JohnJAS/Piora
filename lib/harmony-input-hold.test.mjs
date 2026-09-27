import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { runBoundedHold } = await createJiti(import.meta.url).import("./harmony/input/bounded-hold.ts");
test("a bounded hold dispatches one device-side sequence without repeated clicks or duration clamping", async () => {
  const calls = [];
  const options = { durationMs: 1200, minMs: 3000, maxMs: 5000, dispatch: async () => calls.push("down/hold/up"), release: async () => calls.push("up") };
  await assert.rejects(runBoundedHold(options), error => error.code === "INVALID_ARGUMENT"); assert.deepEqual(calls, []);
  await runBoundedHold({ ...options, minMs: 50 }); assert.deepEqual(calls, ["down/hold/up"]);
});
test("hold interruption attempts release and never disguises uncertain cleanup", async () => {
  let releases = 0;
  const options = { durationMs: 1200, minMs: 50, maxMs: 3000, dispatch: async () => { throw new Error("disconnected"); }, release: async () => { releases++; throw new Error("USB gone"); } };
  await assert.rejects(runBoundedHold(options), error => error.details.cleanup === "uncertain"); assert.equal(releases, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runBoundedHold({ ...options, signal: controller.signal }), error => error.details.dispatchState === "not-sent"); assert.equal(releases, 1);
});
