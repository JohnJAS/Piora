import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const catalog = await jiti.import("./speech-pack-catalog.ts");
const { LOCAL_SPEECH_PACK_ID } = await jiti.import("./speech-types.ts");
const manager = await jiti.import("./speech-pack-manager.ts");
const settingsSubject = await jiti.import("./speech-settings.ts");
const manualFileSubject = await jiti.import("./speech-manual-file.ts");
const packsRoute = readFileSync(new URL("../app/api/speech/packs/route.ts", import.meta.url), "utf8");
const manualRoute = readFileSync(new URL("../app/api/speech/manual/route.ts", import.meta.url), "utf8");
const speechSettingsUi = readFileSync(new URL("../components/SpeechSettings.tsx", import.meta.url), "utf8");
const speechPackManagerSource = readFileSync(new URL("./speech-pack-manager.ts", import.meta.url), "utf8");
const settingsRoute = readFileSync(new URL("../app/api/speech/settings/route.ts", import.meta.url), "utf8");
const transcribeRoute = readFileSync(new URL("../app/api/speech/transcribe/route.ts", import.meta.url), "utf8");
const desktopBuilder = readFileSync(new URL("../desktop/electron-builder.yml", import.meta.url), "utf8");
const beforeBuild = readFileSync(new URL("../scripts/electron-before-build.cjs", import.meta.url), "utf8");
const packagedVerification = readFileSync(new URL("../scripts/verify-packaged-web.mjs", import.meta.url), "utf8");

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

test("enabling an absent pack persists the preference and starts or resumes once", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-speech-enable-"));
  const priorData = process.env.PIORA_DESKTOP_DATA_DIR;
  const priorPacks = process.env.PIORA_SPEECH_PACKS_DIR;
  const priorBundle = process.env.PIORA_BUNDLED_SPEECH_PACK;
  const priorInstall = globalThis.__pioraSpeechPackInstall;
  process.env.PIORA_DESKTOP_DATA_DIR = root;
  process.env.PIORA_SPEECH_PACKS_DIR = path.join(root, "packs");
  delete process.env.PIORA_BUNDLED_SPEECH_PACK;
  try {
    if (!catalog.detectSpeechHardware().supported) return;
    const pending = new Promise(() => {});
    globalThis.__pioraSpeechPackInstall = { running: pending, state: { phase: "downloading", downloadedBytes: 3, totalBytes: 10, updatedAt: new Date().toISOString() } };
    const enabled = await manager.updateSpeechSettings({ enabled: true });
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.installed, false);
    assert.equal(enabled.available, false);
    assert.equal(manager.ensureEnabledSpeechPack(enabled), true);
    assert.equal(manager.waitForSpeechPackInstall(), pending, "do not start a second install");
    await assert.rejects(manager.updateSpeechSettings({ packDirectory: path.join(root, "other") }), /finish/);
    await assert.rejects(manager.removeSpeechPack(), /finish/);
    const disabled = await manager.updateSpeechSettings({ enabled: false });
    assert.equal(manager.ensureEnabledSpeechPack(disabled), false);
    assert.equal((await settingsSubject.readSpeechSettings()).enabled, false);
    const failed = { ...enabled, install: { ...enabled.install, phase: "error" } };
    assert.equal(manager.ensureEnabledSpeechPack(failed), false, "do not retry failures on each status poll");
    assert.equal(manager.ensureEnabledSpeechPack(failed, true), true, "an explicit enable may retry");
  } finally {
    if (priorData === undefined) delete process.env.PIORA_DESKTOP_DATA_DIR; else process.env.PIORA_DESKTOP_DATA_DIR = priorData;
    if (priorPacks === undefined) delete process.env.PIORA_SPEECH_PACKS_DIR; else process.env.PIORA_SPEECH_PACKS_DIR = priorPacks;
    if (priorBundle === undefined) delete process.env.PIORA_BUNDLED_SPEECH_PACK; else process.env.PIORA_BUNDLED_SPEECH_PACK = priorBundle;
    if (priorInstall === undefined) delete globalThis.__pioraSpeechPackInstall; else globalThis.__pioraSpeechPackInstall = priorInstall;
    await rm(root, { recursive: true, force: true });
  }
  for (const route of [settingsRoute, transcribeRoute]) {
    assert.match(route, /ensureEnabledSpeechPack\(status/);
    assert.match(route, /after\(\(\) => waitForSpeechPackInstall\(\)\)/);
  }
  assert.match(speechSettingsUi, /disabled=\{busy \|\| !status \|\| !status\.hardware\.supported\}/);
});

test("selects a pinned native runtime and bounded CPU strategy per environment", () => {
  assert.equal(catalog.getSpeechRuntimeSource("win32", "x64")?.packageName, "sherpa-onnx-win-x64");
  assert.equal(catalog.getSpeechRuntimeSource("linux", "arm64")?.packageName, "sherpa-onnx-linux-arm64");
  assert.equal(catalog.getSpeechRuntimeSource("win32", "arm64"), null);
  const hardware = catalog.detectSpeechHardware();
  assert.ok(hardware.threads >= 1 && hardware.threads <= 8);
  assert.ok(hardware.threads <= hardware.logicalCores);
});

test("a bundled pack works on a fresh profile without downloads and cannot be removed by settings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "piora-bundled-speech-"));
  const keys = ["PIORA_DESKTOP_DATA_DIR", "PIORA_SPEECH_PACKS_DIR", "PIORA_BUNDLED_SPEECH_PACK"];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const bundle = path.join(root, "resources", "speech");
  process.env.PIORA_DESKTOP_DATA_DIR = path.join(root, "user");
  process.env.PIORA_SPEECH_PACKS_DIR = path.join(root, "external");
  process.env.PIORA_BUNDLED_SPEECH_PACK = bundle;
  try {
    const runtime = catalog.getSpeechRuntimeSource();
    if (!runtime) return;
    for (const file of ["model/model.int8.onnx", "model/tokens.txt", "runtime/package.json", "runtime/node_modules/sherpa-onnx-node/package.json", `runtime/node_modules/${runtime.packageName}/package.json`]) {
      const target = path.join(bundle, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, "{}");
    }
    await writeFile(path.join(bundle, "manifest.json"), JSON.stringify({ schema: "piora-local-speech-pack-v1", packId: LOCAL_SPEECH_PACK_ID, version: catalog.SPEECH_PACK_VERSION, engine: "sherpa-onnx", platformKey: `${process.platform}-${process.arch}`, runtimePackage: runtime.packageName, installedBytes: 123 }));
    const initial = await manager.getSpeechStatus();
    assert.equal(initial.installed, true); assert.equal(initial.bundled, true); assert.equal(initial.enabled, false);
    assert.equal(initial.approximateDownloadBytes, 0);
    const enabled = await manager.updateSpeechSettings({ enabled: true });
    assert.equal(enabled.available, true); assert.equal((await manager.verifiedSpeechPackPath()).path, bundle);
    await assert.rejects(manager.removeSpeechPack(), /bundled speech pack/);
    assert.equal((await manager.getSpeechStatus()).available, true);
  } finally {
    for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; }
    await rm(root, { recursive: true, force: true });
  }
});

test("downloads SenseVoice assets from the pinned Piora GitHub release", () => {
  const releaseBase = `https://github.com/kexijiang/Piora/releases/download/speech-pack-${catalog.SPEECH_PACK_VERSION}`;
  assert.equal(catalog.SENSEVOICE_MODEL_SOURCE.url, `${releaseBase}/model.int8.onnx`);
  assert.equal(catalog.SENSEVOICE_TOKENS_SOURCE.url, `${releaseBase}/tokens.txt`);
  assert.equal(catalog.SENSEVOICE_MODEL_SOURCE.digest, "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51");
  assert.equal(catalog.SENSEVOICE_TOKENS_SOURCE.digest, "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc");
});

test("desktop release excludes the speech pack but retains licensing and real on-demand inference verification", () => {
  assert.doesNotMatch(desktopBuilder, /from: build\/speech/);
  assert.doesNotMatch(beforeBuild, /stageSpeech/);
  assert.match(desktopBuilder, /from: \.\.\/third_party\/sensevoice[\s\S]*?to: licenses\/sensevoice/);
  assert.match(packagedVerification, /fresh packaged app must not include or enable the speech pack/);
  assert.match(packagedVerification, /Enabling speech did not start its on-demand installation/);
  assert.match(packagedVerification, /Packaged offline speech inference failed/);
});

test("keeps speech pack installation alive after the initiating page request ends", () => {
  assert.match(packsRoute, /import \{ after, NextResponse \} from "next\/server"/);
  assert.match(packsRoute, /const install = startSpeechPackInstall\(\);/);
  assert.match(packsRoute, /after\(\(\) => waitForSpeechPackInstall\(\)\);/);
  assert.match(packsRoute, /return json\(\{ install \}, 202\);/);
});

test("keeps interrupted downloads in a stable staging directory for restart-safe resume", () => {
  assert.match(speechPackManagerSource, /const STAGING_DIRECTORY_NAME = `\.\$\{PACK_DIRECTORY_NAME\}\.staging`/);
  assert.match(speechPackManagerSource, /prepareInstallStaging\(root, runtimeSource\)/);
  assert.match(speechPackManagerSource, /verifySpeechSourceFile\(source, temporary\)/);
  assert.match(speechPackManagerSource, /Keep verified files and partial downloads so a later retry can resume/);
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
