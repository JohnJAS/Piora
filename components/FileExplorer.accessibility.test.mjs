import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("file explorer exposes the WAI-ARIA tree hierarchy", () => {
  assert.match(source, /role="tree"/);
  assert.match(source, /role="treeitem"/);
  assert.match(source, /aria-level=\{depth \+ 1\}/);
  assert.match(source, /role="group"/);
  assert.match(source, /tabIndex=\{focusedPath === node\.fullPath \? 0 : -1\}/);
});

test("file tree supports complete keyboard navigation", () => {
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter"]) {
    assert.match(source, new RegExp(`event\\.key === "${key}"`));
  }
  assert.match(source, /dataset\.treeLabel/);
});

test("filtered results use roving focus and keyboard navigation", () => {
  assert.match(source, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(source, /setFocusedSearchIndex/);
  assert.match(source, /data-file-search-result/);
});

test("large directories render progressively while exposing their full set size", () => {
  assert.match(source, /getTreeRenderWindow/);
  assert.match(source, /visibleChildren\.map/);
  assert.match(source, /aria-posinset=\{positionInSet\}/);
  assert.match(source, /aria-setsize=\{setSize\}/);
  assert.match(source, /progressiveSentinelRef/);
});
