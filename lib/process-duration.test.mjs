import assert from "node:assert/strict";
import test from "node:test";
import { processTimeRange, processElapsedSeconds } from "./process-duration.ts";

test("elapsed time includes generation and waiting without double-counting parallel tools", () => {
  const results = new Map([
    ["a", { timestamp: 5000 }], ["b", { timestamp: 7000 }],
  ]);
  const range = processTimeRange([{ type: "thinking" }, { type: "toolCall", toolCallId: "a" },
    { type: "toolCall", toolCallId: "b" }], 2000, 0, results);
  assert.deepEqual(range, { start: 0, end: 7000 });
  assert.equal(processElapsedSeconds([range]), 7);
  assert.equal(processElapsedSeconds([range, { start: 9000, end: 12000 }]), 12);
  assert.equal(processElapsedSeconds([range, { start: 5000, end: 9000 }]), 9);
});

test("missing and invalid timing remains distinguishable from zero", () => {
  assert.equal(processTimeRange([{ type: "thinking" }], 1000, 2000), undefined);
  assert.equal(processTimeRange([{ type: "toolCall", toolCallId: "missing" }], 1000, 0), undefined);
  assert.equal(processElapsedSeconds([{ start: 0, end: 2000 }, undefined]), undefined);
  assert.equal(processElapsedSeconds([]), undefined);
  assert.equal(processElapsedSeconds([{ start: 0, end: 0 }]), 0);
});
