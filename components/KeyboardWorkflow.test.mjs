import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [shell, sidebar, catalog, review, changeList, rightPanel] = await Promise.all([
  readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
  readFile(new URL("./sidebar/useSessionCatalog.ts", import.meta.url), "utf8"),
  readFile(new URL("./workspace/ReviewPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("./workspace/ChangeList.tsx", import.meta.url), "utf8"),
  readFile(new URL("./workspace/RightPanel.tsx", import.meta.url), "utf8"),
]);

test("Review supports complete list navigation and keyboard commit", () => {
  assert.match(changeList, /getReviewNavigationIndex/);
  assert.match(changeList, /if \(event\.altKey\) return/);
  assert.match(changeList, /if \(!event\.altKey/);
  assert.match(changeList, /event\.key === " " \|\| event\.key === "Spacebar"/);
  assert.match(changeList, /role="treeitem"/);
  assert.match(changeList, /aria-selected=/);
  assert.match(review, /isCommitKeyboardShortcut\(event\.nativeEvent\)/);
  assert.match(review, /aria-keyshortcuts="Control\+Enter Meta\+Enter"/);
  assert.doesNotMatch(review, /<main className=\{styles\.diffPane\}/);
  assert.match(review, /role="region" aria-label=\{t\("review\.diffRegion"\)\}/);
});

test("F6 cycles sidebar, composer, and workspace panel focus", () => {
  assert.match(shell, /event\.key !== "F6"/);
  assert.match(shell, /sessionSidebarRef\.current\?\.focusTaskSearch\(\)/);
  assert.match(shell, /chatInputRef\.current\?\.focus\(\)/);
  assert.match(shell, /rightPanelRef\.current\?\.focusActiveTab\(\)/);
  assert.match(rightPanel, /activeTab === "home" \? firstLauncherRef\.current : activeTabRef\.current/);
  assert.match(rightPanel, /role="menuitem"/);
  assert.match(rightPanel, /focusActiveTab/);
  assert.match(shell, /aria-hidden=\{!effectiveRightPanelOpen\}/);
  assert.match(shell, /inert=\{!effectiveRightPanelOpen \? true : undefined\}/);
});

test("completed background tasks are announced without stealing focus", () => {
  assert.match(catalog, /completionAnnouncement/);
  assert.match(catalog, /completed = \[\.\.\.previous\]/);
  assert.match(sidebar, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(sidebar, /sidebar\.taskCompleted/);
  assert.match(sidebar, /sidebar\.tasksCompleted/);
});
