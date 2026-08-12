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

test("the continuous review stream scrolls independently from commit controls", () => {
  assert.match(styles, /\.reviewRoot \{[^}]*grid-template-rows: auto auto minmax\(0, 1fr\) auto;[^}]*overflow: hidden;/);
  assert.match(styles, /\.reviewStream \{[^}]*min-height: 0;[^}]*overflow: auto;/);
  assert.match(styles, /\.reviewFooter \{[^}]*border-top:/);
  assert.match(styles, /\.commitPanel \{[^}]*display: grid;/);
});

test("review files start collapsed and expand independently", () => {
  assert.match(reviewPanel, /const \[expandedKeys, setExpandedKeys\] = useState<Set<string>>\(\(\) => new Set\(\)\)/);
  assert.match(reviewPanel, /const collapsed = !expandedKeys\.has\(item\.key\)/);
  assert.match(reviewPanel, /setExpandedKeys\(\(current\) => toggleSet\(current, item\.key\)\)/);
  assert.match(reviewPanel, /setExpandedKeys\(\(current\) => new Set\(current\)\.add\(nextItem\.key\)\)/);
  assert.match(reviewPanel, /filteredItems\.filter\(\(item\) => expandedKeys\.has\(item\.key\)/);
  assert.doesNotMatch(reviewPanel, /collapsedKeys/);
});

test("review renders every filtered file directly without a duplicate overview", () => {
  assert.match(reviewPanel, /filteredItems\.map\(\(item\) =>/);
  assert.doesNotMatch(reviewPanel, /reviewOverview|FileIndexRow|visibleCount|loadMoreFiles/);
});

test("long review diffs use a visible Codex-style scrollbar", () => {
  assert.match(styles, /\.reviewStream::\-webkit-scrollbar \{ width: 10px; height: 10px;/);
  assert.match(styles, /scrollbar-color:/);
  assert.match(styles, /background-clip: padding-box/);
});
