import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  assert.match(
    sessionItemSource,
    /const handleDeleteClick[\s\S]*?if \(e\.shiftKey\) \{\s*void performDelete\(\);\s*\} else \{\s*setConfirmDelete\(true\);/,
  );
});

test("does not register row-level session deletion shortcuts", () => {
  assert.doesNotMatch(sessionItemSource, /const handleKeyDown/);
  assert.doesNotMatch(sessionItemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(sessionItemSource, /tabIndex=\{0\}/);
});

test("polls running sessions only while the tab is visible", () => {
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /fetch\("\/api\/agent\/running"/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

test("renders sessions inside persisted project folders", () => {
  assert.match(source, /buildSessionProjectGroups\(/);
  assert.match(source, /<ProjectSessionGroup/);
  assert.match(source, /pi-gui:sidebar-collapsed-projects:v1/);
  assert.match(source, /pi-gui:sidebar-expanded-project-sessions:v1/);
});

test("project session overflow is accessible and attention-aware", () => {
  assert.match(source, /getVisibleSessionRoots\(group\.tree, sessionsExpanded, attentionSessionIds\)/);
  assert.match(source, /sessionTreeContainsAnyId\(root, attentionSessionIds\)/);
  assert.match(source, /aria-expanded=\{sessionsExpanded\}/);
  assert.match(source, /sidebar\.showMoreSessions/);
  assert.match(source, /sidebar\.showFewerSessions/);
});

test("project opener does not duplicate the recent-project list", () => {
  assert.match(source, /sidebar\.openProject/);
  assert.doesNotMatch(source, /visibleProjects\.map/);
  assert.doesNotMatch(source, /filteredSessions/);
});
