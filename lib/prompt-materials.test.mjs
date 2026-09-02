import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const materials = await jiti.import("./prompt-materials.ts");
const format = await jiti.import("./prompt-material-format.ts");

test("large prompt materials round-trip through a compact runtime marker", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-prompt-materials-"));
  try {
    const original = `${Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n")}\n${"长内容".repeat(2_000)}`;
    const [saved] = materials.savePromptMaterials([{ name: "clipboard.txt", content: original }], root);
    const [resolved] = materials.resolvePromptMaterialReferences([{ id: saved.id }], root);
    const runtimePrompt = materials.buildPromptWithMaterials("请总结", [resolved]);

    assert.equal(format.isPromptMaterialRuntimeMessage(runtimePrompt), true);
    assert.match(runtimePrompt, /use the read tool/);
    assert.ok(runtimePrompt.length < original.length / 2);
    assert.equal(materials.restorePromptMaterialDisplay(runtimePrompt, root), `请总结\n\n${original}`);
    assert.equal(materials.restorePromptMaterialDisplayPreview(runtimePrompt, 30, root).length, 30);
    assert.equal(materials.getPromptMaterialDisplayMetadata(runtimePrompt).lineCount, 22);

    const attachmentOnlyPrompt = materials.buildPromptWithMaterials("", [resolved]);
    assert.equal(materials.getPromptMaterialDisplayMetadata(attachmentOnlyPrompt).lineCount, 21);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prompt material references reject invalid ids and missing files", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-prompt-material-invalid-"));
  try {
    assert.throws(() => materials.resolvePromptMaterialReferences([{ id: "../../escape" }], root), /Invalid prompt material id/);
    assert.throws(() => materials.savePromptMaterials([], root), /between 1 and/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prompt materials preserve safe folder-relative names", () => {
  const root = mkdtempSync(join(tmpdir(), "piora-prompt-material-folder-"));
  try {
    const [saved] = materials.savePromptMaterials([{
      name: "sample-project\\src\\index.ts",
      content: "export const ready = true;",
    }], root);
    assert.equal(saved.name, "sample-project/src/index.ts");

    const [sanitized] = materials.savePromptMaterials([{
      name: "../sample-project/../README.md",
      content: "# Read me",
    }], root);
    assert.equal(sanitized.name, "sample-project/README.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
