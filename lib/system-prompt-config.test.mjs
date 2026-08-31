import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const config = await jiti.import("./system-prompt-config.ts");

test("legacy global prompts migrate into a default reusable template", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-system-prompt-legacy-"));
  const path = join(root, "system-prompt.json");
  try {
    writeFileSync(path, JSON.stringify({
      version: 1,
      prompt: "Always verify changes.",
      updatedAt: "2026-08-31T00:00:00.000Z",
    }), "utf8");
    const migrated = config.readSystemPromptConfig(path);
    assert.equal(migrated.templates.length, 1);
    assert.equal(migrated.templates[0].prompt, "Always verify changes.");
    assert.equal(migrated.defaultTemplateId, migrated.templates[0].id);

    config.updateSystemPromptTemplate(migrated.templates[0].id, { name: "Verifier" }, path);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("templates support create, update, default selection, and deletion", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-system-prompt-library-"));
  const path = join(root, "piora", "system-prompt.json");
  try {
    const created = config.createSystemPromptTemplate("Reviewer", "Review carefully.", path);
    const template = created.templates[0];
    assert.equal(created.defaultTemplateId, template.id);

    const updated = config.updateSystemPromptTemplate(template.id, {
      name: "Strict reviewer",
      prompt: "Review and run tests.",
    }, path);
    assert.equal(updated.templates[0].prompt, "Review and run tests.");
    assert.equal(config.resolveSystemPromptSelection(updated, { mode: "default" }).templateName, "Strict reviewer");

    const piDefault = config.setDefaultSystemPromptTemplate(null, path);
    assert.equal(piDefault.defaultTemplateId, null);
    assert.equal(config.deleteSystemPromptTemplate(template.id, path).templates.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed and unsafe prompt configs fail closed to Pi defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-system-prompt-invalid-"));
  const path = join(root, "system-prompt.json");
  try {
    writeFileSync(path, "{not-json", "utf8");
    assert.deepEqual(config.readSystemPromptConfig(path).templates, []);
    assert.throws(
      () => config.createSystemPromptTemplate("Too long", "x".repeat(config.SYSTEM_PROMPT_MAX_LENGTH + 1), path),
      /must not exceed/,
    );
    assert.throws(() => config.createSystemPromptTemplate("Unsafe", "bad\0prompt", path), /null characters/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
