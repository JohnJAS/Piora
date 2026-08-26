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
  verifyPackagedCompanionAssets,
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

test("packaged companion verification requires reviewed default pet bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-packaged-pet-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePublicRoot = join(root, "source-public");
  const webRoot = join(root, "web");
  const relativeRoot = join("companion-pets", "bundled", "pekka-pal.codex-pet");
  const sourcePetRoot = join(sourcePublicRoot, relativeRoot);
  const packagedPetRoot = join(webRoot, "public", relativeRoot);
  const manifest = JSON.stringify({
    schemaVersion: 1,
    id: "pekka-pal.codex-pet",
    spritesheetPath: "spritesheet.webp",
    frame: { width: 192, height: 208, columns: 8, rows: 11 },
  });
  await mkdir(sourcePetRoot, { recursive: true });
  await mkdir(packagedPetRoot, { recursive: true });
  await writeFile(join(sourcePetRoot, "pet.json"), manifest);
  await writeFile(join(sourcePetRoot, "spritesheet.webp"), Buffer.from("reviewed-pet"));
  await cp(sourcePetRoot, packagedPetRoot, { recursive: true });

  const verified = await verifyPackagedCompanionAssets(webRoot, sourcePublicRoot);
  assert.equal(verified.id, "pekka-pal.codex-pet");
  assert.equal(verified.spritesheetBytes, 12);

  await writeFile(join(packagedPetRoot, "spritesheet.webp"), Buffer.from("tampered-pet"));
  await assert.rejects(
    verifyPackagedCompanionAssets(webRoot, sourcePublicRoot),
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
  assert.match(
    stagingScript,
    /name: "desktop companion client reference manifest",[\s\S]*?page_client-reference-manifest\.js[\s\S]*?required: true,/,
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

test("packaged runtime requires every first-party extension and tool to load", async () => {
  const verifier = await readFile(
    new URL("../scripts/verify-packaged-web.mjs", import.meta.url),
    "utf8",
  );
  const afterPack = await readFile(
    new URL("../scripts/electron-after-pack-licenses.cjs", import.meta.url),
    "utf8",
  );

  assert.match(verifier, /extensions\/piora-browser\.ts/);
  assert.match(verifier, /extensions\/piora-harmony\.ts/);
  assert.match(verifier, /extensions\/piora-vision-agent\.ts/);
  assert.match(verifier, /extensions\/piora-plan\.ts/);
  assert.match(verifier, /extensions\/piora-room\.ts/);
  assert.match(verifier, /lib\/plan-artifact-registry\.ts/);
  assert.match(verifier, /lib\/team-agent-templates\.ts/);
  assert.match(verifier, /"piora_plan_execution"/);
  assert.match(verifier, /"piora_room"/);
  assert.match(verifier, /Packaged first-party extensions failed to load/);
  assert.match(verifier, /Packaged first-party tools are unavailable/);
  assert.match(afterPack, /PIORA_WEB_RUNTIME_ROOT/);
});
