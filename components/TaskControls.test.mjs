import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatInput = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const agentSession = readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const settingsDialog = readFileSync(new URL("./SettingsDialog.tsx", import.meta.url), "utf8");
const settingsCss = readFileSync(new URL("./SettingsDialog.module.css", import.meta.url), "utf8");

test("moves conversation controls out of the composer and top bar into settings", () => {
  assert.doesNotMatch(chatInput, /TOOL_PRESETS|toolDropdown|soundEnabled|onAudioUnlock/);
  assert.match(settingsDialog, /key:\s*"conversation"/);
  assert.match(settingsDialog, /taskControls\.preset\$\{/);
  assert.match(settingsDialog, /conversation\.onGenerateTitle/);
  assert.match(settingsDialog, /conversation\.onNotificationToggle/);
  assert.doesNotMatch(appShell, /topbar-more-button/);
});

test("opens settings as a viewport-wide page above the complete application shell", () => {
  assert.match(appShell, /\{settingsPage\}/);
  assert.match(appShell, /display: settingsDialogOpen \? "none" : "block"/);
  assert.match(appShell, /const effectiveRightPanelOpen = rightPanelOpen && !settingsDialogOpen/);
  assert.match(settingsDialog, /createPortal/);
  assert.match(settingsDialog, /aria-modal="true"/);
  assert.match(settingsDialog, /document\.body/);
  assert.match(settingsCss, /\.backdrop\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s);
  assert.match(settingsDialog, /sections\[activeEntry\.key\]/);
  assert.match(settingsDialog, /onActiveKeyChange\(entry\.key\)/);
  assert.match(appShell, /<ModelsConfig[\s\S]*?embedded/);
  assert.match(appShell, /<SkillsConfig embedded/);
  assert.match(appShell, /<PluginsConfig[\s\S]*?embedded/);
  assert.match(appShell, /<CompanionSettingsDialog[\s\S]*?embedded/);
  assert.doesNotMatch(appShell, /setSettingsDialogOpen\(false\);\s*setModelsConfigOpen/);
});

test("settings exposes a Codex-style back button on the left", () => {
  assert.match(settingsDialog, /className=\{styles\.backButton\}/);
  assert.match(settingsDialog, /name="arrowleft"/);
  assert.match(settingsDialog, /aria-label=\{t\("settings\.back"\)\}/);
  assert.match(settingsDialog, /className=\{styles\.backButton\}[\s\S]*?onClick=\{onClose\}/);
});

test("settings search stays inside the settings page and navigates to matching sections", () => {
  assert.match(settingsDialog, /useDeferredValue\(searchQuery\)/);
  assert.match(settingsDialog, /settings\.searchPlaceholder/);
  assert.match(settingsDialog, /filteredEntries\.map/);
  assert.match(settingsDialog, /setSearchQuery\(""\);\s*onActiveKeyChange\(entry\.key\)/);
  assert.match(settingsCss, /\.searchResults/);
});

test("anchors soft top-bar panels inside the top bar coordinate system", () => {
  const branchNavigator = readFileSync(new URL("./BranchNavigator.tsx", import.meta.url), "utf8");
  assert.match(appShell, /position:\s*"absolute"/);
  assert.match(appShell, /activeTopPanel !== "branches"/);
  assert.match(appShell, /left:\s*leftInViewport - topBarRect\.left/);
  assert.match(appShell, /className="soft-top-panel"/);
  assert.match(branchNavigator, /top:\s*boundaryRect\.height \+ inset/);
  assert.match(branchNavigator, /className="app-floating-panel branch-floating-panel"/);
  assert.match(globalCss, /\.soft-top-panel-header/);
  assert.match(globalCss, /\.soft-menu-item:hover/);
});

test("loads the real preset for idle sessions before enabling the menu", () => {
  assert.match(agentSession, /void loadTools\(session\.id\)/);
  assert.match(agentSession, /const \[toolsLoaded, setToolsLoaded\]/);
  assert.match(chatWindow, /disabled: sessionBusy \|\| !toolsLoaded/);
});

test("keeps the file drawer toggle inside the shell and aligns both header states", () => {
  assert.match(appShell, /className=\{`topbar-control topbar-icon-button right-panel-toggle/);
  assert.match(appShell, /aria-controls="file-panel"/);
  assert.match(appShell, /<SessionHistoryDialog/);
  assert.match(appShell, /\{settingsPage\}/);
  assert.doesNotMatch(appShell, /\{appearanceOpen &&/);
  assert.doesNotMatch(appShell, /position:\s*"fixed", right:\s*8/);
  assert.doesNotMatch(globalCss, /\.right-panel-toggle\s*\{[^}]*top:/s);
});
