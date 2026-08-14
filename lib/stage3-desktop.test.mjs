import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../desktop/src/main.ts", import.meta.url), "utf8");
const state = readFileSync(new URL("../desktop/src/desktop-state.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("../desktop/src/preload.ts", import.meta.url), "utf8");
const drag = readFileSync(new URL("../hooks/useDragDrop.ts", import.meta.url), "utf8");
const supervisor = readFileSync(new URL("../desktop/src/server-supervisor.ts", import.meta.url), "utf8");
const builder = readFileSync(new URL("../desktop/electron-builder.yml", import.meta.url), "utf8");
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

test("desktop uses Pi's default data directory without a startup directory chooser", () => {
  assert.match(main, /function resolvePiAgentDirectory/);
  assert.match(main, /join\(app\.getPath\("home"\), "\.pi", "agent"\)/);
  assert.doesNotMatch(main, /choosePiAgentDirectory|migratePiDataDirectory|writePiAgentDirectory/);
  assert.doesNotMatch(state, /piAgentDirectory/);
  assert.match(supervisor, /PI_CODING_AGENT_DIR: this\.options\.agentDirectory/);
});

test("desktop packages a checksum-pinned local Whisper runtime", () => {
  assert.match(builder, /from: build\/whisper[\s\S]*?to: whisper/);
  assert.match(whisperBuild, /WHISPER_CPP_VERSION = "v1\.9\.2"/);
  assert.match(whisperBuild, /ggml-base-q5_1\.bin/);
  assert.match(whisperBuild, /sha256/);
});
