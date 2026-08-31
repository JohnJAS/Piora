import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const catalog = await jiti.import("./speech-pack-catalog.ts");
const manager = await jiti.import("./speech-pack-manager.ts");
const settingsSubject = await jiti.import("./speech-settings.ts");
const packsRoute = readFileSync(new URL("../app/api/speech/packs/route.ts", import.meta.url), "utf8");

test("local speech defaults off and keeps packs outside the application", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-speech-settings-"));
  const priorDesktopData = process.env.PIORA_DESKTOP_DATA_DIR;
  const priorPackRoot = process.env.PIORA_SPEECH_PACKS_DIR;
  process.env.PIORA_DESKTOP_DATA_DIR = root;
  process.env.PIORA_SPEECH_PACKS_DIR = path.join(root, "external-packs");
  try {
    const initial = await settingsSubject.readSpeechSettings();
    assert.equal(initial.enabled, false);
    assert.equal(initial.packDirectory, path.resolve(root, "external-packs"));

    const saved = await settingsSubject.writeSpeechSettings({
      enabled: false,
      packDirectory: path.join(root, "another-drive"),
    });
    assert.equal(saved.packDirectory, path.resolve(root, "another-drive"));
    assert.equal((await settingsSubject.readSpeechSettings()).enabled, false);
  } finally {
    if (priorDesktopData === undefined) delete process.env.PIORA_DESKTOP_DATA_DIR;
    else process.env.PIORA_DESKTOP_DATA_DIR = priorDesktopData;
    if (priorPackRoot === undefined) delete process.env.PIORA_SPEECH_PACKS_DIR;
    else process.env.PIORA_SPEECH_PACKS_DIR = priorPackRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("selects a pinned native runtime and bounded CPU strategy per environment", () => {
  assert.equal(catalog.getSpeechRuntimeSource("win32", "x64")?.packageName, "sherpa-onnx-win-x64");
  assert.equal(catalog.getSpeechRuntimeSource("linux", "arm64")?.packageName, "sherpa-onnx-linux-arm64");
  assert.equal(catalog.getSpeechRuntimeSource("win32", "arm64"), null);
  const hardware = catalog.detectSpeechHardware();
  assert.ok(hardware.threads >= 1 && hardware.threads <= 8);
  assert.ok(hardware.threads <= hardware.logicalCores);
});

test("downloads SenseVoice assets from the pinned Piora GitHub release", () => {
  const releaseBase = `https://github.com/kexijiang/Piora/releases/download/speech-pack-${catalog.SPEECH_PACK_VERSION}`;
  assert.equal(catalog.SENSEVOICE_MODEL_SOURCE.url, `${releaseBase}/model.int8.onnx`);
  assert.equal(catalog.SENSEVOICE_TOKENS_SOURCE.url, `${releaseBase}/tokens.txt`);
  assert.equal(catalog.SENSEVOICE_MODEL_SOURCE.digest, "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51");
  assert.equal(catalog.SENSEVOICE_TOKENS_SOURCE.digest, "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc");
});

test("keeps speech pack installation alive after the initiating page request ends", () => {
  assert.match(packsRoute, /import \{ after, NextResponse \} from "next\/server"/);
  assert.match(packsRoute, /const install = startSpeechPackInstall\(\);/);
  assert.match(packsRoute, /after\(\(\) => waitForSpeechPackInstall\(\)\);/);
  assert.match(packsRoute, /return json\(\{ install \}, 202\);/);
});

test("exposes the active speech installation promise to the request lifecycle", async () => {
  const prior = globalThis.__pioraSpeechPackInstall;
  const running = Promise.resolve();
  globalThis.__pioraSpeechPackInstall = {
    state: {
      phase: "downloading",
      downloadedBytes: 10,
      totalBytes: 100,
      updatedAt: new Date().toISOString(),
    },
    running,
  };
  try {
    assert.equal(manager.waitForSpeechPackInstall(), running);
    await manager.waitForSpeechPackInstall();
  } finally {
    if (prior === undefined) delete globalThis.__pioraSpeechPackInstall;
    else globalThis.__pioraSpeechPackInstall = prior;
  }
});
