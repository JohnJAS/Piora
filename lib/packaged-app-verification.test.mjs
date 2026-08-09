import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  findForbiddenPackagedDependencies,
  forbiddenPackagedDependencies,
  verifyPackagedBackgroundAssets,
} from "../scripts/verify-packaged-web.mjs";

test("packaged dependency audit finds scoped and nested unused peer packages", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-package-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const scopedDependency = join(root, "node_modules", "@splinetool", "runtime");
  const nestedDependency = join(root, "node_modules", "safe-package", "node_modules", "@lobehub", "ui");
  const harmlessLookalike = join(root, "src", "@giscus", "react");
  await Promise.all([
    mkdir(scopedDependency, { recursive: true }),
    mkdir(nestedDependency, { recursive: true }),
    mkdir(harmlessLookalike, { recursive: true }),
  ]);
  await writeFile(join(harmlessLookalike, "package.json"), "{}\n", "utf8");

  const matches = await findForbiddenPackagedDependencies(root);
  assert.deepEqual(
    matches.map(({ dependency }) => dependency).sort(),
    ["@lobehub/ui", "@splinetool/runtime"],
  );
});

test("packaged background manifest and all 20 assets match source byte-for-byte", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-background-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const webRoot = join(root, "web");
  const sourcePublicRoot = fileURLToPath(new URL("../public/", import.meta.url));
  const sourceBackgroundRoot = join(sourcePublicRoot, "themes", "dream-backgrounds");
  const packagedBackgroundRoot = join(webRoot, "public", "themes", "dream-backgrounds");
  await mkdir(join(webRoot, "public", "themes"), { recursive: true });
  await cp(sourceBackgroundRoot, packagedBackgroundRoot, { recursive: true });

  const verified = await verifyPackagedBackgroundAssets(webRoot, sourcePublicRoot);
  assert.equal(verified.backgroundCount, 20);

  const manifest = JSON.parse(
    await readFile(join(sourceBackgroundRoot, "manifest.json"), "utf8"),
  );
  const firstAssetName = manifest.presets[0].asset.split("/").at(-1);
  const packagedAssetPath = join(packagedBackgroundRoot, firstAssetName);
  const tamperedBytes = await readFile(packagedAssetPath);
  tamperedBytes[0] ^= 0xff;
  await writeFile(packagedAssetPath, tamperedBytes);
  await assert.rejects(
    verifyPackagedBackgroundAssets(webRoot, sourcePublicRoot),
    /differs from source/,
  );
});

test("standalone staging treats public assets as required release input", async () => {
  const stagingScript = await readFile(
    new URL("../scripts/stage-standalone.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    stagingScript,
    /name: "public assets",[\s\S]*?source: join\(projectRoot, "public"\),[\s\S]*?required: true,/,
  );
});

test("packaged extension fixture is an external Pi package, not a Piora SubAgent", async () => {
  const fixtureRoot = new URL("../scripts/fixtures/packaged-pi-extension/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("package.json", fixtureRoot), "utf8"));
  const extension = await readFile(
    new URL("extensions/package-probe.js", fixtureRoot),
    "utf8",
  );
  const skill = await readFile(
    new URL("skills/package-probe/SKILL.md", fixtureRoot),
    "utf8",
  );

  assert.equal(manifest.name, "@piora/packaged-extension-verification-fixture");
  assert.deepEqual(manifest.pi.extensions, ["./extensions/package-probe.js"]);
  assert.deepEqual(manifest.pi.skills, ["./skills/package-probe/SKILL.md"]);
  assert.match(extension, /registerCommand\("packaged-extension-probe"/);
  assert.match(extension, /registerTool\(\{/);
  assert.match(extension, /from "@earendil-works\/pi-ai"/);
  assert.doesNotMatch(extension, /sub[-_ ]?agent/i);
  assert.match(skill, /name: packaged-package-probe/);
  assert.ok(forbiddenPackagedDependencies.includes("@splinetool/runtime"));
});
