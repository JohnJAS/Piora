import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { HarmonyError, defaultHarmonyConfigPath, resolveHdcPath, writeHarmonyConfig } = await jiti.import("./harmony/index.ts");

test("resolves HDC to an absolute executable in deterministic precedence order", () => {
  const existing = new Set([
    "C:\\explicit\\hdc.exe",
    "C:\\env\\hdc.exe",
    "C:\\cfg\\hdc.exe",
    "C:\\Tools\\hdc.exe",
  ]);
  const common = {
    platform: "win32",
    homeDir: "C:\\Users\\test",
    exists: (path) => existing.has(path),
    listDirectory: () => [],
  };

  assert.deepEqual(resolveHdcPath({
    ...common,
    explicitPath: "C:\\explicit\\hdc.exe",
    env: { PIORA_HARMONY_HDC_PATH: "C:\\env\\hdc.exe", PATH: "C:\\Tools" },
    config: { hdcPath: "C:\\cfg\\hdc.exe" },
  }), { hdcPath: "C:\\explicit\\hdc.exe", source: "explicit" });

  assert.deepEqual(resolveHdcPath({
    ...common,
    env: { PIORA_HARMONY_HDC_PATH: "C:\\env\\hdc.exe", PATH: "C:\\Tools" },
    config: { hdcPath: "C:\\cfg\\hdc.exe" },
  }), { hdcPath: "C:\\env\\hdc.exe", source: "environment" });

  assert.deepEqual(resolveHdcPath({
    ...common,
    env: { PATH: "C:\\Tools" },
    config: { hdcPath: "C:\\cfg\\hdc.exe" },
  }), { hdcPath: "C:\\cfg\\hdc.exe", source: "config" });
});

test("rejects a selected HDC path instead of silently falling through", () => {
  assert.throws(() => resolveHdcPath({
    explicitPath: "C:\\missing\\hdc.exe",
    platform: "win32",
    env: {},
    exists: () => false,
    listDirectory: () => [],
  }), (error) => error instanceof HarmonyError && error.code === "HDC_INVALID");
});

test("keeps Harmony configuration inside the active desktop profile", () => {
  assert.equal(
    defaultHarmonyConfigPath({ PIORA_DESKTOP_DATA_DIR: "C:\\Piora\\runtime\\device-control", APPDATA: "C:\\Users\\test\\AppData\\Roaming" }),
    "C:\\Piora\\runtime\\device-control\\harmony.json",
  );
  assert.equal(
    defaultHarmonyConfigPath({ PIORA_HARMONY_CONFIG_PATH: "C:\\explicit\\harmony.json", PIORA_DESKTOP_DATA_DIR: "C:\\ignored" }),
    "C:\\explicit\\harmony.json",
  );
});

test("persisted HDC configuration rejects relative executable paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "piora-harmony-config-"));
  try {
    assert.throws(
      () => writeHarmonyConfig({ hdcPath: "relative\\hdc.exe" }, join(directory, "harmony.json")),
      (error) => error instanceof HarmonyError && error.code === "INVALID_ARGUMENT",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
