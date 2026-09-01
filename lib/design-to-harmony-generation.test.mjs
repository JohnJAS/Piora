import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { analyzeDesignSelection } = await jiti.import("./design-to-harmony/analysis.ts");
const { DesignAnalysisIrStore } = await jiti.import("./design-to-harmony/analysis-ir-store.ts");
const { normalizeFigmaDocumentSummary, normalizeFigmaVariables, parseFigmaSourceUrl } = await jiti.import("./design-to-harmony/figma-adapter.ts");
const { generateArkUiArtifacts } = await jiti.import("./design-to-harmony/generator.ts");
const { DesignPreviewWorkspace, validatePreviewRelativePath } = await jiti.import("./design-to-harmony/preview-workspace.ts");
const { analyzeHarmonyProject } = await jiti.import("./design-to-harmony/project-analyzer.ts");
const { DesignAnalysisRunStore } = await jiti.import("./design-to-harmony/run-store.ts");

const documentFixture = JSON.parse(fs.readFileSync(new URL("./design-to-harmony/fixtures/figma-multipage.json", import.meta.url), "utf8"));
const rawNodeFixture = JSON.parse(fs.readFileSync(new URL("./design-to-harmony/fixtures/figma-analysis-nodes.json", import.meta.url), "utf8"));
const nodeFixture = structuredClone(rawNodeFixture);
nodeFixture["10:1"].document.children = nodeFixture["10:1"].document.children.filter((node) => node.type !== "WIDGET");
const source = parseFigmaSourceUrl("https://www.figma.com/design/Abcdef123/Piora");
const variables = normalizeFigmaVariables({
  meta: {
    variableCollections: {
      collection1: { key: "collection-key", name: "Theme", modes: [{ modeId: "light", name: "Light" }], variableIds: ["variable1"] },
    },
    variables: {
      variable1: { key: "color-key", name: "color/text/primary", variableCollectionId: "collection1", resolvedType: "COLOR", remote: false },
    },
  },
});

function tempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function createHarmonyProject(t) {
  const root = tempRoot(t, "piora-generation-project-");
  const components = path.join(root, "entry", "src", "main", "ets", "components");
  fs.mkdirSync(components, { recursive: true });
  fs.mkdirSync(path.join(root, "entry", "src", "main", "resources"), { recursive: true });
  fs.writeFileSync(path.join(root, "entry", "src", "main", "module.json5"), "{ module: { name: 'entry' } }\n");
  fs.writeFileSync(path.join(components, "Button.ets"), "@Component\nexport struct Button {}\n");
  return root;
}

function payloads(ids) {
  return ids.flatMap((id) => nodeFixture[id] ? [{ id, document: nodeFixture[id].document }] : []);
}

async function analysis(t) {
  const projectRoot = createHarmonyProject(t);
  const record = {
    schemaVersion: 1,
    id: "imp_11111111111111111111",
    projectRoot,
    source,
    document: normalizeFigmaDocumentSummary(documentFixture, source, variables),
    importedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const adapter = { async getNodes(_source, ids) { return payloads(ids); } };
  const result = await analyzeDesignSelection({ record, targetNodeIds: ["10:1"], adapter, project: analyzeHarmonyProject(projectRoot) });
  return { ...result, projectRoot };
}

test("ArkUI generation is byte-stable and matches the reviewed golden output", async (t) => {
  const { ir, plan } = await analysis(t);
  assert.equal(plan.stats.blockingIssues, 0);
  const first = generateArkUiArtifacts("run_11111111111111111111", ir, plan);
  const second = generateArkUiArtifacts("run_11111111111111111111", ir, plan);
  assert.deepEqual(first, second);
  const arkts = first.artifacts.find((artifact) => artifact.record.kind === "arkts");
  const arktsText = arkts.content.toString("utf8");
  const golden = fs.readFileSync(new URL("./design-to-harmony/fixtures/SignIn.golden.ets", import.meta.url), "utf8");
  assert.equal(arktsText, golden);
  assert.match(arktsText, /@Component\nexport struct SignIn/);
  assert.match(arktsText, /import \{ Button \}/);
  assert.match(arktsText, /Image\(\$r\('app\.media\./);
  assert.equal(first.manifest.assetPlan[0].strategy, "placeholder_svg");
  assert.equal(first.manifest.artifacts.every((artifact) => artifact.sha256.length === 64), true);
});

test("preview workspace writes only to isolated storage and protects artifact paths and integrity", async (t) => {
  const { ir, plan, projectRoot } = await analysis(t);
  const dataRoot = tempRoot(t, "piora-generation-data-");
  const before = fs.readdirSync(projectRoot, { recursive: true }).map(String).sort();
  const workspace = new DesignPreviewWorkspace(dataRoot);
  const manifest = workspace.generate("run_11111111111111111111", ir, plan);
  const repeated = workspace.generate("run_11111111111111111111", ir, plan);
  const after = fs.readdirSync(projectRoot, { recursive: true }).map(String).sort();

  assert.deepEqual(before, after, "preview generation must not modify the Harmony project");
  assert.equal(manifest.hash, repeated.hash);
  assert.equal(manifest.artifacts.length, 2);
  const codeArtifact = manifest.artifacts.find((artifact) => artifact.kind === "arkts");
  const file = workspace.readFile(manifest.runId, manifest.id, codeArtifact.relativePath);
  assert.equal(file.content.includes("Generated by Piora"), true);
  assert.equal(file.absolutePath.startsWith(path.resolve(dataRoot)), true);
  assert.throws(() => validatePreviewRelativePath("../project/Index.ets"), (error) => error.code === "INVALID_ARGUMENT");

  fs.appendFileSync(file.absolutePath, "// tampered\n");
  assert.throws(() => workspace.readFile(manifest.runId, manifest.id, codeArtifact.relativePath), (error) => error.code === "PREVIEW_CONFLICT");
});

test("normalized IR storage verifies hashes and generation state recovers as interrupted", async (t) => {
  const { ir, plan, projectRoot } = await analysis(t);
  const dataRoot = tempRoot(t, "piora-generation-state-");
  const irStore = new DesignAnalysisIrStore(dataRoot);
  irStore.save("run_11111111111111111111", ir);
  assert.equal(irStore.get("run_11111111111111111111").hash, ir.hash);
  const irPath = irStore.pathFor("run_11111111111111111111");
  const tampered = JSON.parse(fs.readFileSync(irPath, "utf8"));
  tampered.nodeCount += 1;
  fs.writeFileSync(irPath, JSON.stringify(tampered));
  assert.equal(irStore.get("run_11111111111111111111"), undefined);

  const runStore = new DesignAnalysisRunStore(dataRoot);
  await runStore.save({
    schemaVersion: 1,
    id: "run_11111111111111111111",
    projectRoot,
    importId: ir.sourceImportId,
    sourceVersion: ir.sourceVersion,
    targetNodeIds: ir.targetNodeIds,
    status: "generating",
    revision: 2,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:01.000Z",
    plan,
  });
  assert.equal(runStore.get("run_11111111111111111111").status, "generating", "a live generator must remain generating");
  const restartedRunStore = new DesignAnalysisRunStore(dataRoot);
  const recovered = restartedRunStore.get("run_11111111111111111111");
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.error.retryable, true);
});

test("ArkUI printer keeps untrusted design metadata inside comments", async (t) => {
  const { ir, plan } = await analysis(t);
  const hostileIr = structuredClone(ir);
  hostileIr.roots[0].id = "10:1\nInjected()";
  const hostilePlan = structuredClone(plan);
  hostilePlan.sourceVersion = "version */\nInjected()";
  hostilePlan.files[0].sourceNodeId = hostileIr.roots[0].id;
  const generated = generateArkUiArtifacts("run_11111111111111111111", hostileIr, hostilePlan);
  const code = generated.artifacts.find((artifact) => artifact.record.kind === "arkts").content.toString("utf8");
  assert.doesNotMatch(code, /\nInjected\(\)\n/);
  assert.match(code, /Design node 10:1 Injected\(\)/);
});

test("generation and preview routes require project scope, expected revision, and async params", () => {
  const generateRoute = fs.readFileSync(new URL("../app/api/design-to-harmony/runs/[id]/generate/route.ts", import.meta.url), "utf8");
  const previewRoute = fs.readFileSync(new URL("../app/api/design-to-harmony/runs/[id]/preview/route.ts", import.meta.url), "utf8");
  assert.match(generateRoute, /readDesignJson/);
  assert.match(generateRoute, /validateDesignRevision/);
  assert.match(generateRoute, /designProjectPathsEqual/);
  assert.match(generateRoute, /params: Promise/);
  assert.match(generateRoute, /severity === "blocking"/);
  assert.match(previewRoute, /designProjectPathsEqual/);
  assert.match(previewRoute, /readFile/);
  assert.match(previewRoute, /params: Promise/);
});
