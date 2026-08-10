import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [source, styles] = await Promise.all([
  readFile(new URL("./workspace/ChangeList.tsx", import.meta.url), "utf8"),
  readFile(new URL("./workspace/WorkspacePanel.module.css", import.meta.url), "utf8"),
]);

test("large Review lists render only the selected page", () => {
  assert.match(source, /getReviewListWindow/);
  assert.match(source, /orderedEntries\.slice\(renderWindow\.startIndex, renderWindow\.endIndex\)/);
  assert.match(source, /review\.previousChanges/);
  assert.match(source, /review\.nextChanges/);
});

test("windowed Review items expose their complete group position", () => {
  assert.match(source, /role="group"/);
  assert.match(source, /aria-posinset=\{positionInGroup\}/);
  assert.match(source, /aria-setsize=\{groupSize\}/);
  assert.match(source, /aria-describedby=\{showWindowControls/);
});

test("keyboard selection focuses an item after its page renders", () => {
  assert.match(source, /pendingFocusKey/);
  assert.match(source, /row\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(source, /selectAndFocus\(orderedItems\[nextIndex\]\)/);
});

test("the change list scrolls independently from Git write controls", () => {
  assert.match(styles, /\.reviewSidebar \{[^}]*display: flex;[^}]*overflow: hidden;/);
  assert.match(styles, /\.changeList \{[^}]*flex: 1 1 auto;[^}]*overflow: auto;/);
  assert.match(styles, /\.bulkActions \{[^}]*flex: 0 0 auto;/);
  assert.match(styles, /\.commitPanel \{[^}]*flex: 0 0 auto;/);
});
