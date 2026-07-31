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
  assert.doesNotMatch(mainSource, /^\s*frame:\s*false/m);
});

test("hidden menu keeps the installed application menu and accelerators", () => {
  assert.match(mainSource, /Menu\.setApplicationMenu\(Menu\.buildFromTemplate\(template\)\)/);
  assert.match(mainSource, /accelerator:\s*"CmdOrCtrl\+/);
});

test("web chrome exposes a safe draggable title strip without swallowing controls", () => {
  assert.match(appShellSource, /setDesktopChrome\(Boolean\(window\.piDesktop\)\)/);
  assert.match(appShellSource, /app-shell\$\{desktopChrome \? " desktop-chrome" : ""\}/);
  assert.match(globalStyles, /\.app-shell\.desktop-chrome \.app-topbar[\s\S]*-webkit-app-region:\s*drag/);
  assert.match(globalStyles, /\.app-shell\.desktop-chrome \.app-topbar button[\s\S]*-webkit-app-region:\s*no-drag/);
  assert.match(globalStyles, /env\(titlebar-area-x,\s*0px\)/);
  assert.match(globalStyles, /env\(titlebar-area-width,\s*100vw\)/);
  assert.match(globalStyles, /\.app-shell\.desktop-chrome \.right-panel-tabs[\s\S]*padding-right:/);
});
