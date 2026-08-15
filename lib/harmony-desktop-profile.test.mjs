import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../desktop/src/main.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../desktop/src/preload.ts", import.meta.url), "utf8");
const supervisor = readFileSync(new URL("../desktop/src/server-supervisor.ts", import.meta.url), "utf8");
const state = readFileSync(new URL("../desktop/src/desktop-state.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/workspace/HarmonyPanel.tsx", import.meta.url), "utf8");
const panelStyles = readFileSync(new URL("../components/workspace/HarmonyPanel.module.css", import.meta.url), "utf8");
const liveFrame = readFileSync(new URL("../hooks/useHarmonyLiveFrame.ts", import.meta.url), "utf8");

test("desktop starts one unified runtime with native Harmony path selection", () => {
  assert.match(main, /createStandaloneForProfile\("normal"\)/);
  assert.match(main, /requestHarmonyEmergencyStop\("desktop_shutdown"\)/);
  assert.doesNotMatch(main, /RUNTIME_PROFILE_SWITCH_CHANNEL|restartRuntimeProfile/);
  assert.doesNotMatch(preload, /requestRuntimeProfileSwitch/);
  assert.match(main, /HARMONY_RUNTIME_PICKER_CHANNEL/);
  assert.match(main, /showOpenDialog/);
  assert.match(preload, /selectHarmonyRuntimePath/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\("pi:[^"]*(?:hdc|shell|spawn)/i);
});

test("standalone service receives one shared data directory and migrates legacy Harmony config", () => {
  assert.match(supervisor, /PIORA_RUNTIME_PROFILE/);
  assert.match(supervisor, /PIORA_DESKTOP_DATA_DIR/);
  assert.match(state, /runtimeProfileDataDirectory/);
  assert.match(state, /join\(userDataDirectory, "runtime", "normal"\)/);
  assert.match(state, /legacyConfig/);
  assert.match(state, /copyFileSync\(legacyConfig, unifiedConfig\)/);
});

test("Harmony panel exposes usable manual controls and an emergency stop", () => {
  assert.match(panel, /\/api\/harmony\/devices/);
  assert.match(panel, /\/api\/harmony\/manual/);
  assert.match(panel, /action: "tap"/);
  assert.match(panel, /action: "swipe"/);
  assert.match(panel, /action: "input_text"/);
  assert.match(panel, /action: "launch_app"/);
  assert.match(panel, /action: "emergency_stop"/);
  assert.doesNotMatch(panel, /requestRuntimeProfileSwitch|Switch to device-control mode/);
  assert.match(panel, /desktopAvailable/);
  assert.match(panel, /naturalWidth/);
  assert.match(liveFrame, /X-Harmony-Generation/);
  assert.match(liveFrame, /URL\.createObjectURL/);
  assert.match(liveFrame, /controller\?\.abort\(\)/);
  assert.match(panel, /generation: liveFrame\.generation/);
  assert.doesNotMatch(liveFrame, /setInterval/);
  assert.match(panel, /piora-harmony-manual-owner-v1/);
  assert.match(panel, /ownsRecoverableLease/);
  assert.match(panel, /capabilities\.screenshot/);
  assert.match(panel, /\/api\/harmony\/runtime-candidates/);
  assert.match(panel, /Detected HDC installations/);
  assert.match(panel, /\/api\/harmony\/vision-models/);
});

test("Harmony panel keeps the primary surface minimal and fits the complete phone frame", () => {
  assert.match(panel, /settingsOpen/);
  assert.match(panel, /通常只需设置一次/);
  assert.match(panel, /只负责看手机屏幕/);
  assert.match(panel, /当前对话模型负责操作/);
  assert.match(panel, /<details className=\{styles\.moreActions\}>/);
  assert.match(panel, /AI 控制前会先征求你的同意/);
  assert.match(panelStyles, /\.deviceArea \{[^}]*flex: 1 1 auto/s);
  assert.match(panelStyles, /\.frame img \{[^}]*max-width: 100%;[^}]*max-height: 100%;[^}]*object-fit: contain/s);
  assert.doesNotMatch(panelStyles, /\.frame img \{[^}]*object-fit: cover/s);
});
