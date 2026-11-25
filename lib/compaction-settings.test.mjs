import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettingsManager, shouldCompact } from "@earendil-works/pi-coding-agent";
import {
  applyCompactionThresholdSettings,
  installModelAwareCompactionSettings,
  parseCompactionThresholdSettings,
  readCompactionThresholdSettings,
} from "./compaction-settings.ts";
import { writeRuntimePromptSettings } from "./prompt-runtime/settings.ts";

function withTempAgentDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "piora-compaction-test-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("compaction reserve accepts automatic mode and validates manual values", () => {
  assert.deepEqual(parseCompactionThresholdSettings({ reserveTokens: 8192 }), { reserveTokens: 8192 });
  assert.deepEqual(parseCompactionThresholdSettings({ reserveTokens: null }), { reserveTokens: null });
  for (const value of [-1, 1.5, 131073, "8192", undefined]) {
    assert.throws(() => parseCompactionThresholdSettings({ reserveTokens: value }), /reserveTokens/);
  }
  assert.throws(() => parseCompactionThresholdSettings(null), /reserveTokens/);
});

test("manual reserve and resetting to automatic persist without overwriting other SDK settings", async () => {
  const records = { global: '{"compaction":{"keepRecentTokens":18000}}', project: "{}" };
  const storage = {
    withLock(scope, update) {
      const next = update(records[scope]);
      if (next !== undefined) records[scope] = next;
    },
  };
  const editor = SettingsManager.fromStorage(storage);
  assert.deepEqual(readCompactionThresholdSettings(editor), { reserveTokens: 16384, configuredReserveTokens: null });
  assert.deepEqual(await applyCompactionThresholdSettings(editor, { reserveTokens: 8192 }), {
    reserveTokens: 8192,
    configuredReserveTokens: 8192,
  });
  assert.equal(JSON.parse(records.global).compaction.reserveTokens, 8192);
  const existingSession = SettingsManager.fromStorage(storage);
  assert.equal(existingSession.getCompactionSettings().reserveTokens, 8192);
  assert.equal(existingSession.getCompactionSettings().keepRecentTokens, 18000);
  assert.deepEqual(await applyCompactionThresholdSettings(editor, { reserveTokens: null }), {
    reserveTokens: 16384,
    configuredReserveTokens: null,
  });
  assert.deepEqual(JSON.parse(records.global).compaction, { keepRecentTokens: 18000 });
  await existingSession.reload();
  assert.deepEqual(readCompactionThresholdSettings(existingSession), { reserveTokens: 16384, configuredReserveTokens: null });
});

test("automatic compaction aligns standard windows with Pi CLI while protecting narrow windows and preserving legacy mode", (t) => {
  const dir = withTempAgentDir(t);
  const manager = SettingsManager.inMemory();
  installModelAwareCompactionSettings(manager);
  const narrow = { provider: "test", id: "narrow", contextWindow: 8192, maxTokens: 1024 };
  const wide = { provider: "test", id: "wide", contextWindow: 128000, maxTokens: 32768 };

  // Default (alignCliCompaction: true): wide aligns with SDK 16384; narrow stays protected at 5120.
  for (const [model, reserveTokens, keepRecentTokens] of [[narrow, 5120, 1536], [wide, 16384, 20000]]) {
    const settings = manager.getCompactionSettings(model);
    const threshold = model.contextWindow - reserveTokens;
    assert.deepEqual(settings, { enabled: true, reserveTokens, keepRecentTokens });
    assert.equal(shouldCompact(threshold, model.contextWindow, settings), false);
    assert.equal(shouldCompact(threshold + 1, model.contextWindow, settings), true);
  }
  assert.equal(manager.getCompactionSettings().reserveTokens, 16384, "callers without a model retain SDK defaults");

  // Legacy Piora mode (alignCliCompaction: false): uses model-aware reserve on wide windows too.
  writeRuntimePromptSettings({ alignCliCompaction: false }, dir);
  assert.deepEqual(manager.getCompactionSettings(wide), { enabled: true, reserveTokens: 33800, keepRecentTokens: 20000 });
  assert.deepEqual(manager.getCompactionSettings(narrow), { enabled: true, reserveTokens: 5120, keepRecentTokens: 1536 });
});

test("valid project and model overrides take precedence, including zero", (t) => {
  withTempAgentDir(t);
  const records = {
    global: '{"compaction":{"reserveTokens":16384}}',
    project: '{"compaction":{"reserveTokens":8192,"modelOverrides":{"test/explicit":{"reserveTokens":0,"keepRecentTokens":200}}}}',
  };
  const manager = SettingsManager.fromStorage({ withLock(scope, read) { read(records[scope]); } });
  installModelAwareCompactionSettings(manager);
  const model = { provider: "test", id: "small", contextWindow: 8192, maxTokens: 1024 };
  assert.equal(manager.getCompactionSettings(model).reserveTokens, 5120, "an oversized override would eliminate the entire input budget");
  assert.equal(manager.getCompactionSettings({ ...model, contextWindow: 32000 }).reserveTokens, 8192);
  assert.deepEqual(manager.getCompactionSettings({ ...model, id: "explicit" }), {
    enabled: true,
    reserveTokens: 0,
    keepRecentTokens: 200,
  });
  assert.deepEqual(readCompactionThresholdSettings(manager), { reserveTokens: 8192, configuredReserveTokens: 16384 });
});
