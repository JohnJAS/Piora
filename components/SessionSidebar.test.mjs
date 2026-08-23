import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const taskRowSource = await readFile(new URL("./sidebar/TaskRow.tsx", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const sidebarStyles = await readFile(new URL("./SessionSidebar.module.css", import.meta.url), "utf8");
const splitSources = await Promise.all([
  "ProjectList.tsx", "SidebarNavigation.tsx", "SidebarProjectArea.tsx", "SidebarFileArea.tsx",
  "useSessionCatalog.ts", "sidebar-utils.ts", "sidebar-types.ts", "useProjectPicker.ts", "WorktreeSection.tsx",
].map((file) => readFile(new URL(`./sidebar/${file}`, import.meta.url), "utf8")));
const source = [mainSource, taskRowSource, ...splitSources].join("\n");
const sessionItemSource = taskRowSource.slice(taskRowSource.indexOf("export function TaskRow("));
const sidebarSource = source;

test("always confirms session deletion and offers undo (no Shift+click bypass)", () => {
  // Task T-01: Shift+click no longer skips the confirmation — every delete
  // goes through the confirm state first, and deletion stays reversible.
  assert.doesNotMatch(sidebarSource, /e\.shiftKey/);
  assert.match(taskRowSource, /const handleDeleteClick[\s\S]*?setConfirmDelete\(true\);/);
  assert.match(taskRowSource, /const handleDeleteConfirm[\s\S]*?void performDelete\(\);/);
  assert.match(source, /const handleUndoDelete[\s\S]*?\/restore/);
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
  assert.match(source, /document\.addEventListener\("visibilitychange", (?:onVisibilityChange|visibility)\)/);
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

test("selected sessions use a neutral Codex-style background without an accent rail", () => {
  const selectedStyles = globalStyles.slice(
    globalStyles.indexOf(".sidebar-project-row.is-selected"),
    globalStyles.indexOf("/* No press-down translate", globalStyles.indexOf(".sidebar-project-row.is-selected")),
  );
  assert.match(selectedStyles, /background:\s*var\(--bg-selected\)/);
  assert.match(selectedStyles, /box-shadow:\s*none/);
  assert.doesNotMatch(selectedStyles, /inset|var\(--accent\)/);
});

test("project headings stay transparent while selected sessions keep their fill", () => {
  const projectStyles = sidebarStyles.slice(
    sidebarStyles.indexOf(".projectRow"),
    sidebarStyles.indexOf(".projectMain"),
  );
  assert.match(projectStyles, /\.projectRowSelected\s*\{\s*background:\s*transparent/);
  assert.doesNotMatch(projectStyles, /\.projectRow:hover[\s\S]*?background:/);
});

test("renders sessions inside persisted project folders", () => {
  assert.match(source, /buildSessionProjectGroups\(/);
  assert.match(source, /<ProjectSessionGroup/);
  assert.match(source, /piora:sidebar-collapsed-projects:v1/);
  assert.match(source, /piora:sidebar-expanded-project-sessions:v1/);
  assert.match(source, /piora:sidebar-pinned-projects:v1/);
  assert.match(source, /piora:sidebar-project-aliases:v1/);
  assert.match(source, /piora:sidebar-remembered-projects:v1/);
  assert.match(source, /piora:sidebar-hidden-projects:v1/);
  assert.match(source, /piora:sidebar-project-order:v1/);
});

test("keeps empty projects and lets stale renamed paths be removed from the list", () => {
  assert.match(source, /rememberProject\(cwd\)/);
  assert.match(source, /visibleRememberedProjects/);
  assert.match(source, /hiddenProjectRoots\.has\(session\.projectRoot \?\? session\.cwd\)/);
  assert.match(source, /const removeProject = useCallback/);
  assert.match(source, /onRemoveProject=\{\(\) => removeProject\(group\.projectRoot\)\}/);
  assert.match(source, /sidebar\.removeProjectDescription/);
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
  assert.match(source, /styles\.pinnedUnpin/);
  assert.match(source, /togglePinnedProject\(group\.projectRoot\)/);
});

test("project session overflow is accessible and attention-aware", () => {
  assert.match(source, /getVisibleSessionRoots\(group\.tree, sessionsExpanded, attentionSessionIds\)/);
  assert.match(source, /new Set<string>\(\[\.\.\.runningSessionIds, \.\.\.unreadSessionIds\]\)/);
  assert.match(source, /const projectOpen = !isCollapsed/);
  assert.match(source, /name=\{projectOpen \? "folder-open" : "folder"\}/);
  assert.match(sidebarSource, /sidebar-running-spinner/);
  assert.match(source, /aria-expanded=\{sessionsExpanded\}/);
  assert.match(source, /sidebar\.showMoreSessions/);
  assert.match(source, /sidebar\.showFewerSessions/);
  assert.match(source, /onSelectProject\(\); onToggleProject\(\);/);
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

test("uses a compact Codex-style Piora brand row without the old animated title", () => {
  assert.doesNotMatch(source, /PiWebTitle|useScramble|sidebar-title-row/);
  assert.match(source, /sidebar\.appMenu/);
  assert.match(source, /\{showWorktreeSwitcher && <div\s+className="sidebar-header"/);
  assert.doesNotMatch(source, /<span>Piora<\/span>[\s\S]{0,120}rotate\(90deg\)/);
});

test("keeps project navigation visible with one settings entry and no duplicate extension shortcuts", () => {
  assert.match(source, /styles\.projectsHeader/);
  assert.match(source, /onOpenSettings/);
  assert.doesNotMatch(source, /onOpenSkills|onOpenPlugins/);
  assert.doesNotMatch(source, /styles\.accountButton|styles\.footer|accountLabel/);
});

test("uses a settings gear instead of the notification bell", () => {
  const settingsButton = source.slice(
    source.indexOf("onClick={onOpenSettings}"),
    source.indexOf("</button>", source.indexOf("onClick={onOpenSettings}")),
  );
  assert.match(settingsButton, /AliIcon name="setting"/);
  assert.doesNotMatch(settingsButton, /AliIcon name="notification"/);
});
