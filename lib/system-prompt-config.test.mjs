import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const config = await jiti.import("./system-prompt-config.ts");

test("custom system prompts round-trip through the private global config", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-system-prompt-"));
  const path = join(root, "piora", "system-prompt.json");
  try {
    const saved = config.writeSystemPromptConfig("Always verify changes.", path);
    assert.equal(saved.prompt, "Always verify changes.");
    assert.equal(config.readSystemPromptConfig(path).prompt, "Always verify changes.");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 1);

    config.writeSystemPromptConfig(null, path);
    assert.equal(config.readSystemPromptConfig(path).prompt, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("malformed and unsafe prompt configs fail closed to the default prompt", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-system-prompt-invalid-"));
  const path = join(root, "system-prompt.json");
  try {
    writeFileSync(path, "{not-json", "utf8");
    assert.equal(config.readSystemPromptConfig(path).prompt, null);
    assert.throws(
      () => config.writeSystemPromptConfig("x".repeat(config.SYSTEM_PROMPT_MAX_LENGTH + 1), path),
      /must not exceed/,
    );
    assert.throws(() => config.writeSystemPromptConfig("bad\0prompt", path), /null characters/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
