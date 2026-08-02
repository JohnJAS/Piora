import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatInput = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const agentSession = readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("moves tool presets out of the composer into the task menu", () => {
  assert.doesNotMatch(chatInput, /TOOL_PRESETS|toolDropdown|soundEnabled|onAudioUnlock/);
  assert.match(appShell, /role="menuitemradio"/);
  assert.match(appShell, /taskControls\.presetOff/);
  assert.match(appShell, /taskControls\.presetDefault/);
  assert.match(appShell, /taskControls\.presetFull/);
  assert.match(appShell, /conversationMenu\.buttonLabel/);
  assert.doesNotMatch(appShell, /disabled=\{!taskControls\}/);
  assert.match(appShell, /activeTopPanel === "taskControls"\s*&&\s*\(/);
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
  assert.match(appShell, /className=\{`right-panel-toggle \$\{rightPanelOpen \? "is-open" : "is-closed"\}`\}/);
  assert.match(appShell, /<\/button>\s*<\/div>\s*\{historyDialogOpen/);
  assert.match(appShell, /<SessionHistoryDialog[\s\S]*?\{appearanceOpen/);
  assert.match(globalCss, /\.right-panel-toggle\s*\{[^}]*top:\s*8px/s);
  assert.match(globalCss, /\.right-panel-toggle\.is-open\s*\{[^}]*top:\s*4px/s);
  assert.match(globalCss, /@media \(min-width: 960px\)[\s\S]*?\.right-panel-toggle\s*\{[^}]*top:\s*16px/s);
});
