import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createJiti } from "jiti";
const runtime = await createJiti(import.meta.url).import("./harmony/project-source.ts");

test("project discovery and source fingerprint follow ArkTS edits while ignoring build output", async () => {
  const root = await mkdtemp(join(tmpdir(), "piora-harmony-check-"));
  try {
    await mkdir(join(root, "entry", "src", "main", "ets"), { recursive: true });
    await mkdir(join(root, "entry", "build"), { recursive: true });
    await writeFile(join(root, "build-profile.json5"), "{ app: {}, modules: [] }");
    const source = join(root, "entry", "src", "main", "ets", "Index.ets");
    await writeFile(source, "const answer: number = 42;\n");
    await writeFile(join(root, "entry", "build", "Generated.ets"), "broken");
    assert.equal(runtime.findHarmonyProjectRoot(join(root, "entry", "src")), root);
    assert.deepEqual(runtime.collectArktsFiles(root), [source]);
    const before = runtime.sourceFingerprint(root);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await writeFile(source, "const answer: number = 43;\n");
    assert.notEqual(runtime.sourceFingerprint(root), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("explicit ArkTS files cannot escape the selected project", async () => {
  const root = await mkdtemp(join(tmpdir(), "piora-harmony-check-path-"));
  try {
    await writeFile(join(root, "build-profile.json5"), "{ app: {}, modules: [] }");
    const outside = join(root, "..", `outside-${Date.now()}.ets`);
    await writeFile(outside, "const value = 1;");
    assert.throws(() => runtime.collectArktsFiles(root, [outside]), /inside the project/);
    await rm(outside, { force: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});
