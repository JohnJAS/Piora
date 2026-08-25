import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listSource = await readFile(new URL("./TaskList.tsx", import.meta.url), "utf8");
const rowSource = await readFile(new URL("./TaskRow.tsx", import.meta.url), "utf8");
const rowStyles = await readFile(new URL("./TaskRow.module.css", import.meta.url), "utf8");
const menuSource = await readFile(new URL("./TaskContextMenu.tsx", import.meta.url), "utf8");
const sidebarSource = [
  await readFile(new URL("../SessionSidebar.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./SidebarFooter.tsx", import.meta.url), "utf8"),
].join("\n");
const settingsSource = await readFile(new URL("../SettingsDialog.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../AppShell.tsx", import.meta.url), "utf8");

test("pins active tasks and removes archived tasks from the project sidebar", () => {
  assert.match(listSource, /compareFlags/);
  assert.match(listSource, /withoutArchivedNodes/);
  assert.match(listSource, /if \(flags\[node\.session\.id\]\?\.archived\) return children/);
  assert.doesNotMatch(listSource, /sidebar\.archivedTasks|archivedOpen/);
});

test("provides the complete task context menu", () => {
  for (const key of ["pinTask", "rename", "archiveTask", "duplicateTask", "copySessionPath", "revealSession", "delete"]) {
    assert.match(menuSource, new RegExp(`sidebar\\.${key}`));
  }
  assert.match(rowSource, /onContextMenu=/);
});

test("keeps a pinned task control visible and returns unpinned controls to hover", () => {
  assert.match(rowSource, /data-pinned-actions=\{pinned \? "true" : "false"\}/);
  assert.match(rowSource, /opacity: hovered \|\| pinned \? 1 : 0/);
  assert.match(rowSource, /sidebar\.unpinTask/);
  assert.match(rowSource, /sidebar\.pinTask/);
  assert.match(rowSource, /active=\{pinned\}/);
});

test("keeps AI title optimization inside the Codex-style rename editor", () => {
  assert.match(rowSource, /readSessionTitlePrompt/);
  assert.match(rowSource, /apply: false/);
  assert.match(rowSource, /currentTitle: renameValue\.trim\(\) \|\| title/);
  assert.match(rowSource, /styles\.renameEditor/);
  assert.match(rowSource, /styles\.renameAiButton/);
  assert.match(rowSource, /optimizingTitle \? "close" : "sparkles"/);
  assert.doesNotMatch(rowSource, /name=\{optimizingTitle \? "reload" : "robot"\}/);
  assert.match(rowSource, /if \(name === title\) return/);
  assert.ok(rowSource.indexOf("className={styles.renameInput}") < rowSource.indexOf("styles.renameAiButton"));
  assert.match(rowStyles, /\.renameEditor:focus-within/);
  assert.match(rowStyles, /var\(--text-muted\) 52%/);
  assert.doesNotMatch(rowStyles, /\.renameEditor[^}]*border:[^;]*var\(--accent\)/s);
  assert.match(rowStyles, /\.renameAiButtonLoading/);
});

test("allows title generation to be cancelled and chooses its model in settings", () => {
  assert.match(rowSource, /titleOptimizationAbortRef\.current\?\.abort\(\)/);
  assert.match(rowSource, /signal: controller\.signal/);
  assert.match(rowSource, /optimizingTitle \? "close" : "sparkles"/);
  assert.match(settingsSource, /settings\.sessionTitleModelTitle/);
  assert.match(settingsSource, /writeSessionTitleModel/);
  assert.match(appShellSource, /readSessionTitleModel\(window\.localStorage\)/);
});

test("removes the low-value task search field and its filtering path", () => {
  assert.doesNotMatch(sidebarSource, /taskSearch|Ctrl\+Shift\+F/);
  assert.doesNotMatch(listSource, /searchQuery|sessionMatchesSearch/);
  assert.doesNotMatch(rowSource, /searchQuery|<mark/);
});

test("persists flags through the flags API and offers archive undo", () => {
  assert.match(sidebarSource, /fetch\("\/api\/sessions\/flags"/);
  assert.match(sidebarSource, /const undoArchive/);
  assert.match(sidebarSource, /sidebar\.taskArchived/);
});

test("automatically dismisses the archive success notice", () => {
  assert.match(sidebarSource, /ARCHIVED_SESSION_TOAST_DURATION_MS = 5_000/);
  assert.match(sidebarSource, /window\.setTimeout\(\(\) => \{/);
  assert.match(sidebarSource, /setArchivedSessionToast\(\(current\) => current\?\.id === archivedSessionId \? null : current\)/);
  assert.match(sidebarSource, /return \(\) => window\.clearTimeout\(timer\)/);
});
