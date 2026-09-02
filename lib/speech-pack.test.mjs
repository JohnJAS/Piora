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
const manualFileSubject = await jiti.import("./speech-manual-file.ts");
const packsRoute = readFileSync(new URL("../app/api/speech/packs/route.ts", import.meta.url), "utf8");
const manualRoute = readFileSync(new URL("../app/api/speech/manual/route.ts", import.meta.url), "utf8");
const speechSettingsUi = readFileSync(new URL("../components/SpeechSettings.tsx", import.meta.url), "utf8");

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

test("always offers checksum-verified manual speech-pack download and drag import", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-manual-speech-"));
  const priorDesktopData = process.env.PIORA_DESKTOP_DATA_DIR;
  process.env.PIORA_DESKTOP_DATA_DIR = root;
  try {
    const state = await manager.getManualSpeechPackState();
    assert.equal(state.platformKey, `${process.platform}-${process.arch}`);
    assert.ok(state.sources.length >= 4);
    assert.equal(state.complete, false);
    assert.ok(state.sources.every((source) => source.url.startsWith("https://")));
    const model = state.sources.find((source) => source.name === "model.int8.onnx");
    assert.equal(model?.expectedBytes, 239_233_841);
    assert.equal(model?.algorithm, "sha256");
    assert.equal(model?.digest, catalog.SENSEVOICE_MODEL_SOURCE.digest);
    await assert.rejects(
      manager.storeManualSpeechPackSource("tokens.txt", new Blob(["not-a-real-token-file"]).stream(), 21),
      /Checksum verification failed[\s\S]*received 21 bytes[\s\S]*expected 315894 bytes/,
    );
    await assert.rejects(
      manager.storeManualSpeechPackSource("unexpected.zip", new Blob(["x"]).stream(), 1),
      /does not belong/,
    );
  } finally {
    if (priorDesktopData === undefined) delete process.env.PIORA_DESKTOP_DATA_DIR;
    else process.env.PIORA_DESKTOP_DATA_DIR = priorDesktopData;
    await rm(root, { recursive: true, force: true });
  }
  assert.match(manualRoute, /storeManualSpeechPackSource/);
  assert.match(manualRoute, /startManualSpeechPackInstall/);
  assert.match(manualRoute, /after\(\(\) => waitForSpeechPackInstall\(\)\)/);
  assert.match(speechSettingsUi, /onDrop=\{handleDrop\}/);
  assert.match(speechSettingsUi, /manual\.sources\.map/);
  assert.match(speechSettingsUi, /source\.digest\.slice/);
  assert.match(speechSettingsUi, /speech\.manualChecksumHelp/);
  assert.match(speechSettingsUi, /type="file"/);
});

test("accepts harmless browser duplicate suffixes for manually downloaded speech files", () => {
  const expected = ["model.int8.onnx", "tokens.txt", "sherpa-onnx-win-x64-1.13.6.tgz"];
  assert.equal(manualFileSubject.matchManualSpeechSourceName("model.int8.onnx", expected), "model.int8.onnx");
  assert.equal(manualFileSubject.matchManualSpeechSourceName("model.int8 (1).onnx", expected), "model.int8.onnx");
  assert.equal(manualFileSubject.matchManualSpeechSourceName("tokens (2).txt", expected), "tokens.txt");
  assert.equal(manualFileSubject.matchManualSpeechSourceName("unrelated.onnx", expected), null);
  assert.match(speechSettingsUi, /manualFeedback/);
  assert.match(speechSettingsUi, /speech\.manualFileAdded/);
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
