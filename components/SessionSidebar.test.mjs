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

test("switches sessions immediately while another session is running", () => {
  const switchSource = source.slice(
    source.indexOf("const handleSelectSessionFromList"),
    source.indexOf("const handleNewSessionInProject"),
  );
  assert.doesNotMatch(switchSource, /window\.confirm/);
  assert.match(switchSource, /setSelectedCwd\(s\.cwd\)/);
  assert.match(switchSource, /onSelectSession\(s\)/);
});

test("hover actions overlay a fixed-height session row without reflow", () => {
  assert.match(sessionItemSource, /position:\s*"relative"/);
  assert.match(sessionItemSource, /Action buttons[^]*position:\s*"absolute"/);
  assert.match(sessionItemSource, /opacity:\s*hovered \? 1 : 0/);
  assert.doesNotMatch(sessionItemSource, /\{hovered && \(/);
  assert.match(source, /className="sidebar-project-scroll"/);
});

test("renders sessions inside persisted project folders", () => {
  assert.match(source, /buildSessionProjectGroups\(/);
  assert.match(source, /<ProjectSessionGroup/);
  assert.match(source, /pi-gui:sidebar-collapsed-projects:v1/);
  assert.match(source, /pi-gui:sidebar-expanded-project-sessions:v1/);
  assert.match(source, /pi-gui:sidebar-pinned-projects:v1/);
  assert.match(source, /pi-gui:sidebar-project-aliases:v1/);
});

test("matches the Codex project rail with real pin, metadata, edit, and new-chat actions", () => {
  assert.match(source, /styles\.brandRow/);
  assert.match(source, /styles\.primaryNav/);
  assert.match(source, /pinnedProjectGroups\.map/);
  assert.match(source, /function ProjectContextMenu/);
  assert.match(source, /\/api\/project-info\?cwd=/);
  assert.match(source, /sidebar\.projectTaskSummary/);
  assert.match(source, /onTogglePinned/);
  assert.match(source, /onRenameProject/);
  assert.match(source, /onNewSession/);
});

test("project session overflow is accessible and attention-aware", () => {
  assert.match(source, /getVisibleSessionRoots\(group\.tree, sessionsExpanded, attentionSessionIds\)/);
  assert.match(source, /new Set<string>\(\[\.\.\.runningSessionIds, \.\.\.unreadSessionIds\]\)/);
  assert.match(source, /const projectOpen = !isCollapsed/);
  assert.match(source, /name=\{projectOpen \? "folder-open" : "folder"\}/);
  assert.match(source, /sidebar-running-spinner/);
  assert.match(source, /aria-expanded=\{sessionsExpanded\}/);
  assert.match(source, /sidebar\.showMoreSessions/);
  assert.match(source, /sidebar\.showFewerSessions/);
});

test("project creation lives in the projects header without a duplicate list", () => {
  assert.match(source, /sidebar\.newProject/);
  assert.match(source, /sidebar\.useDefaultDirectory/);
  assert.doesNotMatch(source, /sidebar\.openProject/);
  assert.doesNotMatch(source, /visibleProjects\.map/);
  assert.doesNotMatch(source, /filteredSessions/);
});

test("exposes the existing validated project picker to shell-level project actions", () => {
  assert.match(source, /export interface SessionSidebarHandle\s*\{\s*openProjectPicker:\s*\(\) => void;/);
  assert.match(source, /forwardRef<SessionSidebarHandle, Props>/);
  assert.match(source, /useImperativeHandle\(ref,[\s\S]*?openProjectPicker:\s*handleCustomPathClick/);
  assert.match(source, /handleCustomPathClick[\s\S]*?setCustomPathOpen\(true\)/);
  assert.match(source, /commitCustomPath[\s\S]*?fetch\("\/api\/cwd\/validate"/);
});

test("keeps the real worktree switcher without an inactive repo-root hint", () => {
  assert.match(source, /showWorktreeSwitcher/);
  assert.match(source, /sidebar\.switchWorktreeTitle/);
  assert.doesNotMatch(source, /inactiveWorktreeSelector/);
  assert.doesNotMatch(source, /sidebar\.openRepoRoot/);
});

test("uses a compact Codex-style piGUI brand row without the old animated title", () => {
  assert.doesNotMatch(source, /PiWebTitle|useScramble|sidebar-title-row/);
  assert.match(source, /sidebar\.appMenu/);
  assert.match(source, /\{showWorktreeSwitcher && <div\s+className="sidebar-header"/);
});
