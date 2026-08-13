import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../desktop/src/main.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../desktop/src/preload.ts", import.meta.url), "utf8");
const supervisor = readFileSync(new URL("../desktop/src/server-supervisor.ts", import.meta.url), "utf8");
const state = readFileSync(new URL("../desktop/src/desktop-state.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/workspace/HarmonyPanel.tsx", import.meta.url), "utf8");

test("desktop starts normal and profile switching is native-confirmed and restart-based", () => {
  assert.match(main, /currentRuntimeProfile: RuntimeProfile = "normal"/);
  assert.match(main, /createStandaloneForProfile\("normal"\)/);
  assert.match(main, /dialog\.showMessageBox\(ownerWindow/);
  assert.match(main, /previousServer\?\.stop\(\)/);
  assert.match(main, /requestHarmonyEmergencyStop\("runtime_profile_switch"\)/);
  assert.match(main, /requestHarmonyEmergencyStop\("desktop_shutdown"\)/);
  assert.match(main, /startStandaloneForProfile\(target\)/);
  assert.match(main, /RUNTIME_PROFILE_SWITCH_CHANNEL/);
  assert.match(preload, /requestRuntimeProfileSwitch/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\("pi:[^"]*(?:hdc|shell|spawn)/i);
});

test("standalone service receives isolated profile and data directory", () => {
  assert.match(supervisor, /PIORA_RUNTIME_PROFILE/);
  assert.match(supervisor, /PIORA_DESKTOP_DATA_DIR/);
  assert.match(state, /runtimeProfileDataDirectory/);
  assert.match(state, /join\(userDataDirectory, "runtime", profile\)/);
  assert.match(state, /do not live in desktop-state\.json/);
});

test("Harmony panel exposes usable manual controls and an emergency stop", () => {
  assert.match(panel, /\/api\/harmony\/devices/);
  assert.match(panel, /\/api\/harmony\/manual/);
  assert.match(panel, /action: "tap"/);
  assert.match(panel, /action: "swipe"/);
  assert.match(panel, /action: "input_text"/);
  assert.match(panel, /action: "launch_app"/);
  assert.match(panel, /action: "emergency_stop"/);
  assert.match(panel, /requestRuntimeProfileSwitch/);
  assert.match(panel, /naturalWidth/);
  assert.match(panel, /setInterval\(requestFrame, 1_000\)/);
  assert.match(panel, /frameLoadingRef\.current/);
  assert.match(panel, /generation: selected\?\.generation/);
});
