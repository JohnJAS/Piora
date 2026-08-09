import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(
  new URL("../desktop/src/main.ts", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(
  new URL("../components/AppShell.tsx", import.meta.url),
  "utf8",
);

test("desktop shell integrates content with native window controls", () => {
  assert.match(mainSource, /titleBarStyle:\s*"hidden"/);
  assert.match(mainSource, /titleBarOverlay:\s*{/);
  assert.match(mainSource, /color:\s*"#00000000"/);
  assert.match(mainSource, /symbolColor:\s*"#737373"/);
  assert.match(mainSource, /height:\s*DESKTOP_TITLE_BAR_HEIGHT/);
  assert.match(mainSource, /autoHideMenuBar:\s*true/);
  assert.match(mainSource, /function createCompanionWindow[\s\S]*frame:\s*false[\s\S]*transparent:\s*true/);
});

test("hidden menu keeps the installed application menu and accelerators", () => {
  assert.match(mainSource, /Menu\.setApplicationMenu\(applicationMenu\)/);
  assert.match(mainSource, /accelerator:\s*"CmdOrCtrl\+/);
  assert.match(mainSource, /registerApplicationMenuPopupHandler\(\)/);
  assert.match(appShellSource, /window\.piDesktop\?\.openMenu/);
});

test("desktop menus keep one settings entry and only window-level view actions", () => {
  assert.equal((mainSource.match(/sendMenuAction\("settings"\)/g) ?? []).length, 1);
  assert.doesNotMatch(mainSource, /app-menu-tools|sendMenuAction\("(?:models|skills|plugins|appearance|language|companion-settings)"\)/);
  assert.match(mainSource, /sendMenuAction\("toggle-companion"\)/);
  assert.match(appShellSource, /case "settings"/);
  assert.match(appShellSource, /case "toggle-companion"/);
  assert.doesNotMatch(appShellSource, /sidebar-user-menu|sidebarMenuOpen|currentModelInfo/);
  assert.doesNotMatch(appShellSource, /themeBtnRef|languageBtnRef|app-topbar-appearance/);
});

test("web chrome exposes a Codex-style draggable menu strip without swallowing controls", () => {
  assert.match(appShellSource, /setDesktopChrome\(Boolean\(window\.piDesktop\)\)/);
  assert.match(appShellSource, /app-shell\$\{desktopChrome \? " desktop-chrome" : ""\}/);
  assert.match(appShellSource, /className="desktop-titlebar"/);
  assert.match(globalStyles, /\.app-shell\.desktop-chrome \.desktop-titlebar[\s\S]*-webkit-app-region:\s*drag/);
  assert.match(globalStyles, /\.desktop-titlebar-menu[\s\S]*-webkit-app-region:\s*no-drag/);
  assert.match(globalStyles, /env\(titlebar-area-x,\s*0px\)/);
  assert.match(globalStyles, /env\(titlebar-area-width,\s*100vw\)/);
});
