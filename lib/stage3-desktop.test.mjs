import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../desktop/src/main.ts", import.meta.url), "utf8");
const state = readFileSync(new URL("../desktop/src/desktop-state.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../desktop/src/preload.ts", import.meta.url), "utf8");
const agentDataDirectory = readFileSync(new URL("../desktop/src/agent-data-directory.ts", import.meta.url), "utf8");
const settingsDialog = readFileSync(new URL("../components/SettingsDialog.tsx", import.meta.url), "utf8");
const drag = readFileSync(new URL("../hooks/useDragDrop.ts", import.meta.url), "utf8");
const supervisor = readFileSync(new URL("../desktop/src/server-supervisor.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("../desktop/electron-builder.yml", import.meta.url), "utf8");
const desktopPackage = JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8"));
const whisperBuild = readFileSync(new URL("../scripts/prepare-whisper-resources.mjs", import.meta.url), "utf8");

test("desktop stage three capabilities remain explicit and IPC-scoped", () => {
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /readMainWindowState/);
  assert.match(main, /writeMainWindowState/);
  assert.match(main, /webContents\.on\("context-menu"/);
  assert.match(main, /new Tray/);
  assert.match(main, /globalShortcut\.register/);
  assert.match(main, /isTrustedMainWindowSender/);
  assert.match(state, /maximized: boolean/);
  assert.match(preload, /pi:set-global-shortcut/);
  assert.match(drag, /item\.kind === "file"/);
});

test("desktop microphone permission is scoped to app audio only", () => {
  assert.match(main, /permission === "media" && details\.mediaType === "audio"/);
  assert.match(main, /mediaTypes\?\.every\(\(mediaType\) => mediaType === "audio"\)/);
  assert.match(main, /details\.isMainFrame/);
  assert.doesNotMatch(main, /mediaType === "video"/);
});

test("desktop defaults to Pi's data directory and supports a safe settings migration", () => {
  assert.match(main, /function resolvePiAgentDirectory/);
  assert.match(main, /resolve\(app\.getPath\("home"\), "\.pi", "agent"\)/);
  assert.match(main, /writePiAgentDirectory/);
  assert.match(main, /runningTaskCount > 0/);
  assert.match(state, /piAgentDirectory/);
  assert.match(preload, /pi:agent-data-directory-apply/);
  assert.match(agentDataDirectory, /target-not-empty/);
  assert.match(agentDataDirectory, /preserveTimestamps: true/);
  assert.match(settingsDialog, /settings\.agentDataMigrate/);
  assert.match(settingsDialog, /settings\.agentDataDirectoryApply/);
  assert.match(supervisor, /PI_CODING_AGENT_DIR: this\.options\.agentDirectory/);
});

test("desktop packages a checksum-pinned local Whisper runtime", () => {
  assert.match(builder, /from: build\/whisper[\s\S]*?to: whisper/);
  assert.match(whisperBuild, /WHISPER_CPP_VERSION = "v1\.9\.2"/);
  assert.match(whisperBuild, /ggml-base-q5_1\.bin/);
  assert.match(whisperBuild, /sha256/);
});

test("desktop declares a Linux AppImage target without applying Windows NSIS hooks", () => {
  assert.match(builder, /linux:\s*[\s\S]*?target:\s*[\s\S]*?- target: AppImage/);
  assert.match(builder, /linux:\s*[\s\S]*?executableName: Piora/);
  assert.match(builder, /artifactName: \$\{productName\}-\$\{version\}-linux-x64-portable\.\$\{ext\}/);
  assert.equal(desktopPackage.desktopName, "Piora");
  const packagedVerifier = readFileSync(new URL("../scripts/verify-packaged-web.mjs", import.meta.url), "utf8");
  assert.match(packagedVerifier, /isWindowsPackage \? "tray-icon\.ico" : "tray-icon\.png"/);
  assert.match(packagedVerifier, /isWindowsPackage \? "piora\.exe" : "piora"/);
  const beforeBuild = readFileSync(new URL("../scripts/electron-before-build.cjs", import.meta.url), "utf8");
  assert.match(beforeBuild, /targetPlatform !== "win32"/);
  assert.match(beforeBuild, /available: false/);
});
