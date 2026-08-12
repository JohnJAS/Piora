import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../desktop/src/main.ts", import.meta.url), "utf8");
const builderConfig = readFileSync(new URL("../desktop/electron-builder.yml", import.meta.url), "utf8");
const packageVerifier = readFileSync(new URL("../scripts/verify-packaged-web.mjs", import.meta.url), "utf8");

test("the packaged desktop app ships and installs a reliable system tray icon", () => {
  assert.match(builderConfig, /from:\s*build\/icon\.ico[\s\S]*?to:\s*tray-icon\.ico/);
  assert.match(mainSource, /join\(process\.resourcesPath,\s*"tray-icon\.ico"\)/);
  assert.match(packageVerifier, /await assertFile\(trayIconPath\)/);
  assert.match(mainSource, /tray\s*=\s*new Tray\(/);
  assert.match(mainSource, /tray\.on\("click",\s*\(\)\s*=>\s*focusMainWindow\(\)\)/);
  assert.ok(
    mainSource.indexOf("installTray();") < mainSource.indexOf("serverUrl = await server.start();"),
    "the tray should be available while the bundled service starts",
  );
});

test("closing the main window keeps Piora in the tray and the tray can quit completely", () => {
  assert.match(
    mainSource,
    /window\.on\("close",[\s\S]*?if \(quitRequested \|\| PORTABLE_SMOKE_TEST\) return;[\s\S]*?event\.preventDefault\(\);[\s\S]*?window\.hide\(\);/,
  );
  assert.match(mainSource, /"Quit Piora completely"[\s\S]*?quitRequested = true;[\s\S]*?app\.quit\(\);/);
  assert.match(mainSource, /app\.on\("before-quit",[\s\S]*?quitRequested = true;/);
  assert.doesNotMatch(mainSource, /app\.on\("window-all-closed",\s*\(\)\s*=>\s*app\.quit\(\)\)/);
});

test("startup reuses the visible shell without inflating the portable payload", () => {
  assert.match(builderConfig, /^compression:\s*normal$/m);
  assert.match(mainSource, /const startup = createStartupWindow\(logger\);\s*mainWindow = startup\.window;/);
  assert.match(mainSource, /await loadApplicationWindow\(mainWindow, serverUrl, logger\);/);
  assert.doesNotMatch(mainSource, /startup\.window\.destroy\(\)/);
  assert.equal(
    (mainSource.match(/new BrowserWindow\(/g) ?? []).length,
    2,
    "only the reusable main shell and optional companion should allocate BrowserWindows",
  );
});
