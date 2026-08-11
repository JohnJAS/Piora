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
  assert.match(reviewPanel, /setExpandedKeys\(\(current\) => new Set\(current\)\.add\(item\.key\)\)/);
  assert.match(reviewPanel, /visibleItems\.filter\(\(item\) => expandedKeys\.has\(item\.key\)/);
  assert.doesNotMatch(reviewPanel, /collapsedKeys/);
});
