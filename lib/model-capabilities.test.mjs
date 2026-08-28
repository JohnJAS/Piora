import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  applyConfiguredImageInput,
  getConfiguredImageInput,
  modelSupportsImages,
  writeConfiguredImageInput,
} = await jiti.import("./model-capabilities.ts");

const textModel = { provider: "p", id: "text-only", input: ["text"] };
const visionModel = { provider: "p", id: "vision", input: ["text", "image"] };

test("capability falls back to the model declaration when nothing is configured", () => {
  assert.equal(modelSupportsImages(textModel), false);
  assert.equal(modelSupportsImages(visionModel), true);
  assert.equal(modelSupportsImages(undefined), false);
  assert.equal(getConfiguredImageInput("p", "vision"), undefined);
});

test("an explicit false overrides a catalog that declares image input", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-model-capabilities-"));
  try {
    writeConfiguredImageInput("p", "vision", false, root);
    assert.equal(getConfiguredImageInput("p", "vision", root), false);
    assert.equal(modelSupportsImages(visionModel, root), false);
    assert.match(readFileSync(join(root, "piora", "model-capabilities.json"), "utf8"), /"p\/vision": false/);

    // Session models declared image-capable are downgraded so the vision
    // agent's routing check sees a text-only model.
    const applied = applyConfiguredImageInput(visionModel, root);
    assert.deepEqual(applied.input, ["text"]);
    assert.equal(applyConfiguredImageInput(textModel, root), textModel);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an explicit true upgrades a model that only declares text input", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-model-capabilities-"));
  try {
    writeConfiguredImageInput("p", "text-only", true, root);
    assert.equal(modelSupportsImages(textModel, root), true);
    const applied = applyConfiguredImageInput(textModel, root);
    assert.deepEqual(applied.input, ["text", "image"]);
    assert.equal(applyConfiguredImageInput(visionModel, root), visionModel);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
