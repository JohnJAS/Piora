import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getSideChatSettingsPath,
  parseSideChatSettings,
  readSideChatSettings,
  writeSideChatSettings,
} = await jiti.import("./settings.ts");

function withTempAgentEnv(run) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "piora-side-chat-settings-"));
    const prevHome = process.env.PIORA_HOME;
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PIORA_HOME = dir;
    process.env.PI_CODING_AGENT_DIR = join(dir, ".pi", "agent");
    try {
      await run(dir);
    } finally {
      if (prevHome === undefined) delete process.env.PIORA_HOME;
      else process.env.PIORA_HOME = prevHome;
      if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("readSideChatSettings defaults to disabled when no settings file exists", withTempAgentEnv(() => {
  assert.deepEqual(readSideChatSettings(), { enabled: false });
}));

test("writeSideChatSettings validates strictly and persists round-trip", withTempAgentEnv(() => {
  const saved = writeSideChatSettings({ enabled: true });
  assert.deepEqual(saved, { enabled: true });
  assert.deepEqual(readSideChatSettings(), { enabled: true });

  const disabled = writeSideChatSettings({ enabled: false });
  assert.deepEqual(disabled, { enabled: false });
  assert.deepEqual(readSideChatSettings(), { enabled: false });

  assert.throws(() => parseSideChatSettings(null), TypeError);
  assert.throws(() => parseSideChatSettings([]), TypeError);
  assert.throws(() => parseSideChatSettings({ enabled: "true" }), TypeError);
  assert.throws(() => parseSideChatSettings({ enabled: true, extra: 1 }), TypeError);
}));

test("readSideChatSettings fails closed when persisted JSON is corrupt", withTempAgentEnv(() => {
  const settingsPath = getSideChatSettingsPath();
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, "{\"enabled\":\"yes\"}", "utf8");
  assert.throws(() => readSideChatSettings(), /Side chat settings are invalid/);
}));
