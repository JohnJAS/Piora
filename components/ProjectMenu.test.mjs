import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("turns the top-bar folder into an accessible Codex-style project menu", () => {
  assert.match(appShell, /type TopPanel = [^;]*"project"/);
  assert.match(appShell, /ref=\{projectBtnRef\}[\s\S]*?toggleTopPanel\("project"\)/);
  assert.match(appShell, /aria-haspopup="menu"[\s\S]*?aria-expanded=\{activeTopPanel === "project"\}/);
  assert.match(appShell, /activeTopPanel === "project"[\s\S]*?data-project-menu/);
  assert.match(appShell, /currentProjectName \?\? translate\("projectMenu\.noProject"\)/);
  assert.match(appShell, /className=\{`app-topbar-title-path/);
  assert.match(appShell, /selectedSession\?\.name \?\? translate\("i18n\.newSession"\)/);
});

test("keeps project actions in the renderer without restoring an open-root shell bridge", () => {
  assert.match(appShell, /handleNewSessionInCurrentProject/);
  assert.match(appShell, /handleOpenProjectPicker/);
  assert.match(appShell, /handleCopyCurrentProjectPath/);
  assert.match(appShell, /!sidebarOpen &&/);
  assert.doesNotMatch(appShell, /openProjectFolder|openRepoRoot|shell\.openPath/);
});

test("routes native and top-bar project selection through the sidebar picker", () => {
  assert.match(appShell, /sessionSidebarRef\.current\?\.openProjectPicker\(\)/);
  assert.match(appShell, /case "choose-project":\s*handleOpenProjectPicker\(\)/);
  assert.match(appShell, /<SessionSidebar\s+ref=\{sessionSidebarRef\}/);
});

test("anchors, focuses, and restores the project menu with the shared panel mechanism", () => {
  assert.match(appShell, /activeTopPanel === "project"\s*\? projectBtnRef\.current/);
  assert.match(appShell, /if \(projectBtnRef\.current\) ro\.observe\(projectBtnRef\.current\)/);
  assert.match(appShell, /if \(!topPanelPos \|\| autoFocusedTopPanelRef\.current === activeTopPanel\) return/);
  assert.match(appShell, /firstItem\.focus\(\);\s*autoFocusedTopPanelRef\.current = activeTopPanel/);
  assert.match(appShell, /topPanelFrameRef\.current\?\.querySelectorAll/);
  assert.match(appShell, /if \(activeTopPanel === "project"\) projectBtnRef\.current\?\.focus\(\)/);
});
