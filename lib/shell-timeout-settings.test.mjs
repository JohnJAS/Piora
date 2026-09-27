import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";

const { readShellTimeoutSettings, writeShellTimeoutSettings } = await createJiti(import.meta.url).import("./shell-timeout-settings.ts");

test("shell timeout defaults to 30 minutes and saved settings override the legacy environment value", (t) => {
  const root = mkdtempSync(join(tmpdir(), "piora-shell-timeout-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.deepEqual(readShellTimeoutSettings(root, {}), { timeoutSeconds: 1800 });
  assert.deepEqual(readShellTimeoutSettings(root, { PIORA_SHELL_TIMEOUT_SECONDS: "120" }), { timeoutSeconds: 120 });
  assert.deepEqual(writeShellTimeoutSettings({ timeoutSeconds: 2400 }, root), { timeoutSeconds: 2400 });
  assert.deepEqual(readShellTimeoutSettings(root, { PIORA_SHELL_TIMEOUT_SECONDS: "120" }), { timeoutSeconds: 2400 });
  assert.deepEqual(JSON.parse(readFileSync(join(root, "piora", "shell-timeout.json"), "utf8")), { timeoutSeconds: 2400 });

  for (const value of [null, {}, { timeoutSeconds: 0 }, { timeoutSeconds: 1.5 }, { timeoutSeconds: "600" }, { timeoutSeconds: 2_147_484 }]) {
    assert.throws(() => writeShellTimeoutSettings(value, root), /timeoutSeconds/);
  }
  assert.deepEqual(readShellTimeoutSettings(root, {}), { timeoutSeconds: 2400 });
  writeFileSync(join(root, "piora", "shell-timeout.json"), "broken");
  assert.deepEqual(readShellTimeoutSettings(root, {}), { timeoutSeconds: 1800 });
});
