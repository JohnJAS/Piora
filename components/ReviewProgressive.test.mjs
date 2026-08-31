import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [source, styles, reviewPanel] = await Promise.all([
  readFile(new URL("./workspace/ChangeList.tsx", import.meta.url), "utf8"),
  readFile(new URL("./workspace/WorkspacePanel.module.css", import.meta.url), "utf8"),
  readFile(new URL("./workspace/ReviewPanel.tsx", import.meta.url), "utf8"),
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

test("the review workbench keeps navigation, one focused diff, and commit controls independent", () => {
  assert.match(styles, /\.reviewRoot \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\) auto;/);
  assert.match(styles, /\.reviewWorkbench \{[^}]*grid-template-columns: minmax\(214px, 29%\) minmax\(0, 1fr\);[^}]*overflow: hidden;/);
  assert.match(styles, /\.reviewNavigator \{[^}]*overflow: hidden;/);
  assert.match(styles, /\.reviewDiffViewport \{[^}]*overflow: auto;/);
  assert.match(styles, /\.reviewFooter \{[^}]*border-top:/);
  assert.match(styles, /\.commitPanel \{[^}]*display: grid;/);
});

test("review loads and renders only the selected file diff", () => {
  assert.match(reviewPanel, /const selectedDiff = selectedItem \? diffs\[selectedItem\.key\] : undefined/);
  assert.match(reviewPanel, /<main className=\{styles\.reviewDetail\}/);
  assert.match(reviewPanel, /<DiffView className=\{styles\.reviewDiff\} patch=\{selectedDiff\.patch\}/);
  assert.match(reviewPanel, /selectRelativeFile\(-1\)/);
  assert.match(reviewPanel, /selectRelativeFile\(1\)/);
  assert.doesNotMatch(reviewPanel, /expandedKeys|collapsedKeys/);
});

test("review uses one virtualized file navigator without a duplicate overview", () => {
  assert.match(reviewPanel, /<aside className=\{styles\.reviewNavigator\}/);
  assert.match(reviewPanel, /<ChangeList/);
  assert.doesNotMatch(reviewPanel, /reviewOverview|FileIndexRow|visibleCount|loadMoreFiles|filteredItems\.map/);
});

test("long review diffs use a visible Codex-style scrollbar", () => {
  assert.match(styles, /\.reviewDiffViewport::-webkit-scrollbar \{ width: 10px; height: 10px;/);
  assert.match(styles, /scrollbar-color:/);
  assert.match(styles, /background-clip: padding-box/);
});
