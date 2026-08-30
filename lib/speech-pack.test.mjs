import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const catalog = await jiti.import("./speech-pack-catalog.ts");
const settingsSubject = await jiti.import("./speech-settings.ts");

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
