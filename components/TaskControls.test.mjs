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

test("opens settings as an embedded workspace page instead of a viewport modal", () => {
  assert.match(appShell, /\{settingsPage\}/);
  assert.match(appShell, /display: settingsDialogOpen \? "none" : "block"/);
  assert.match(appShell, /const effectiveRightPanelOpen = rightPanelOpen && !settingsDialogOpen/);
  assert.doesNotMatch(settingsDialog, /createPortal|aria-modal|app-shell-dialog-backdrop/);
  assert.match(settingsDialog, /role="region"/);
  assert.match(settingsCss, /\.backdrop\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%/s);
  assert.doesNotMatch(settingsCss, /position:\s*fixed|backdrop-filter/);
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
  assert.match(appShell, /<SessionHistoryDialog[\s\S]*?\{appearanceOpen/);
  assert.doesNotMatch(appShell, /position:\s*"fixed", right:\s*8/);
  assert.doesNotMatch(globalCss, /\.right-panel-toggle\s*\{[^}]*top:/s);
});
