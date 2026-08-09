import assert from "node:assert/strict";
import test from "node:test";
import {
  getNextTreeRenderCount,
  getTreeRenderWindow,
  TREE_INITIAL_RENDER_COUNT,
  TREE_RENDER_STEP,
} from "./tree-progressive.ts";

test("bounds the first render of a very large directory", () => {
  assert.deepEqual(getTreeRenderWindow(5_000, TREE_INITIAL_RENDER_COUNT), {
    endIndex: TREE_INITIAL_RENDER_COUNT,
    remaining: 4_800,
  });
});

test("reveals large directories in stable batches without exceeding the total", () => {
  const next = getNextTreeRenderCount(TREE_INITIAL_RENDER_COUNT, 450);
  assert.equal(next, TREE_INITIAL_RENDER_COUNT + TREE_RENDER_STEP);
  assert.equal(getNextTreeRenderCount(next, 450), 450);
  assert.deepEqual(getTreeRenderWindow(12, 0), { endIndex: 12, remaining: 0 });
});
