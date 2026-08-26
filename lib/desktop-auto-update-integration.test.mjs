import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [builder, main, preload, appShell, styles, releaseWorkflow, desktopPackage] = await Promise.all([
  readFile(new URL("../desktop/electron-builder.yml", import.meta.url), "utf8"),
  readFile(new URL("../desktop/src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../desktop/src/preload.ts", import.meta.url), "utf8"),
  readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
  readFile(new URL("../desktop/package.json", import.meta.url), "utf8").then(JSON.parse),
]);

test("Windows installer lets users choose a location and preserves application data", () => {
  assert.match(builder, /- target: nsis/);
  assert.match(builder, /nsis:\s*[\s\S]*?oneClick: false/);
  assert.match(builder, /allowToChangeInstallationDirectory: true/);
  assert.match(builder, /perMachine: false/);
  assert.match(builder, /deleteAppDataOnUninstall: false/);
  assert.match(builder, /artifactName: \$\{productName\}-\$\{version\}-win-x64-setup\.\$\{ext\}/);
});

test("installed Piora checks GitHub releases without silently installing", () => {
  assert.equal(desktopPackage.dependencies["electron-updater"], "6.8.9");
  assert.match(builder, /publish:\s*[\s\S]*?provider: github[\s\S]*?owner: kexijiang[\s\S]*?repo: Piora/);
  assert.match(main, /supported = app\.isPackaged[\s\S]*?process\.platform === "win32"/);
  assert.match(main, /!process\.env\.PORTABLE_EXECUTABLE_FILE/);
  assert.match(main, /automaticUpdateCheckTimer = setTimeout/);
  assert.match(main, /runningTaskCount > 0/);
  assert.match(main, /await shutdownPromise[\s\S]*?quitAndInstall\(\)/);
});

test("Help visibly advertises and controls an available update", () => {
  assert.match(main, /updateAvailable: "有更新"/);
  assert.match(main, /点击下载/);
  assert.match(main, /restartToInstall: "重启并安装"/);
  assert.match(preload, /pi:update-state-get/);
  assert.match(preload, /pi:update-state/);
  assert.match(appShell, /desktop-titlebar-update-badge/);
  assert.match(appShell, /locale === "zh-CN" \? "有更新" : "Update"/);
  assert.match(styles, /\.desktop-titlebar-update-badge/);
});

test("release workflow verifies and publishes updater metadata with the installer", () => {
  assert.match(releaseWorkflow, /verify-windows-update-artifacts\.mjs desktop\/release/);
  assert.match(releaseWorkflow, /Install and smoke-test NSIS application/);
  assert.match(releaseWorkflow, /\*-setup\.exe\.blockmap/);
  assert.match(releaseWorkflow, /desktop\/release\/latest\.yml/);
  assert.match(releaseWorkflow, /Piora-\$version-win-x64-setup\.exe/);
});
