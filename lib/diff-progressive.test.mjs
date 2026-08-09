import assert from "node:assert/strict";
import test from "node:test";
import {
  DIFF_RENDER_BATCH,
  getDiffRenderWindow,
  getNextDiffRenderCount,
} from "./diff-progressive.ts";

test("bounds a large diff to one initial render batch", () => {
  assert.deepEqual(getDiffRenderWindow(12_000, DIFF_RENDER_BATCH), {
    endIndex: DIFF_RENDER_BATCH,
    remaining: 11_600,
  });
});

test("reveals large diffs incrementally without crossing the total", () => {
  assert.equal(getNextDiffRenderCount(400, 1_050), 800);
  assert.equal(getNextDiffRenderCount(800, 1_050), 1_050);
  assert.deepEqual(getDiffRenderWindow(20, 0), { endIndex: 20, remaining: 0 });
});
