import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const config = await jiti.import("./prompt-modes.ts");

test("the legacy prompt-mode config facade remains tolerant and atomically writable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-prompt-mode-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.deepEqual(config.parsePromptModeConfig("not json"), { goalMode: true, planMode: true });
  assert.deepEqual(config.readPromptModeConfig(root), { goalMode: true, planMode: true });
  assert.deepEqual(config.writePromptModeConfig({ planMode: false }, root), { goalMode: true, planMode: false });
  assert.deepEqual(config.readPromptModeConfig(root), { goalMode: true, planMode: false });
});
