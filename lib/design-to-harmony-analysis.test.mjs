import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { analyzeDesignSelection, validateDesignTargets } = await jiti.import("./design-to-harmony/analysis.ts");
const { collectDesignDependencies } = await jiti.import("./design-to-harmony/dependency-graph.ts");
const { normalizeFigmaDocumentSummary, normalizeFigmaVariables, parseFigmaSourceUrl, FigmaSourceAdapter } = await jiti.import("./design-to-harmony/figma-adapter.ts");
const { normalizeDesignNodes } = await jiti.import("./design-to-harmony/normalize.ts");
const { analyzeHarmonyProject } = await jiti.import("./design-to-harmony/project-analyzer.ts");
const { DesignAnalysisRunStore, designAnalysisRunId, runDesignAnalysisOnce, resetDesignAnalysisRunStoreForTests } = await jiti.import("./design-to-harmony/run-store.ts");

const documentFixture = JSON.parse(fs.readFileSync(new URL("./design-to-harmony/fixtures/figma-multipage.json", import.meta.url), "utf8"));
const nodeFixture = JSON.parse(fs.readFileSync(new URL("./design-to-harmony/fixtures/figma-analysis-nodes.json", import.meta.url), "utf8"));
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

function record(projectRoot) {
  return {
    schemaVersion: 1,
    id: "imp_11111111111111111111",
    projectRoot,
    source,
    document: normalizeFigmaDocumentSummary(documentFixture, source, variables),
    importedAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function createHarmonyProject(t) {
  const root = tempRoot(t, "piora-harmony-plan-");
  const ets = path.join(root, "entry", "src", "main", "ets", "components");
  fs.mkdirSync(ets, { recursive: true });
  fs.mkdirSync(path.join(root, "entry", "src", "main", "resources"), { recursive: true });
  fs.writeFileSync(path.join(root, "entry", "src", "main", "module.json5"), "{ module: { name: 'entry' } }\n");
  fs.writeFileSync(path.join(ets, "Button.ets"), "@Component struct Button {}\n");
  return root;
}

function payloads(ids) {
  return ids.flatMap((id) => nodeFixture[id] ? [{ id, document: nodeFixture[id].document }] : []);
}

test("normalization and dependency closure are stable for the same version", () => {
  const input = {
    sourceImportId: "imp_11111111111111111111",
    sourceVersion: "987654321",
    targetNodeIds: ["10:1"],
    payloads: payloads(["10:1"]),
  };
  const first = normalizeDesignNodes(input);
  const second = normalizeDesignNodes(input);
  assert.equal(first.hash, second.hash);
  assert.equal(first.nodeCount, 5);
  assert.deepEqual(collectDesignDependencies(first), {
    componentNodeIds: ["21:1"],
    variableIds: ["variable-missing", "variable1"],
    assetRefs: ["image-hero"],
    interactionNodeIds: ["10:2"],
  });
});

test("project analysis discovers Harmony modules and reusable ArkUI components", (t) => {
  const root = createHarmonyProject(t);
  const inventory = analyzeHarmonyProject(root);
  assert.equal(inventory.selectedModule, "entry");
  assert.equal(inventory.modules[0].sourceRoot, "entry/src/main/ets");
  assert.deepEqual(inventory.modules[0].components, [{ name: "Button", relativePath: "entry/src/main/ets/components/Button.ets" }]);
});

test("analysis pins the imported version, resolves dependencies, and produces an inspectable deterministic plan", async (t) => {
  const projectRoot = createHarmonyProject(t);
  const imported = record(projectRoot);
  const calls = [];
  const adapter = {
    async getNodes(_source, ids, _signal, versionId) {
      calls.push({ ids, versionId });
      return payloads(ids);
    },
  };
  const before = fs.readdirSync(projectRoot, { recursive: true }).map(String).sort();
  const first = await analyzeDesignSelection({
    record: imported,
    targetNodeIds: ["10:1"],
    adapter,
    project: analyzeHarmonyProject(projectRoot),
  });
  const second = await analyzeDesignSelection({
    record: imported,
    targetNodeIds: ["10:1"],
    adapter,
    project: analyzeHarmonyProject(projectRoot),
  });
  const after = fs.readdirSync(projectRoot, { recursive: true }).map(String).sort();

  assert.deepEqual(calls.slice(0, 2), [
    { ids: ["10:1"], versionId: "987654321" },
    { ids: ["10:2", "21:1"], versionId: "987654321" },
  ]);
  assert.equal(first.plan.hash, second.plan.hash);
  assert.equal(first.plan.id, second.plan.id);
  assert.deepEqual(before, after, "read-only analysis must not write to the Harmony project");
  assert.equal(first.plan.files[0].relativePath.startsWith("entry/src/main/ets/generated/design/"), true);
  assert.equal(first.plan.componentMappings.find((mapping) => mapping.sourceNodeId === "11:2").strategy, "project_component");
  assert.equal(first.plan.variableMappings[0].resourceType, "color");
  assert.equal(first.plan.interactionMappings[0].strategy, "router_push");
  assert.deepEqual(first.plan.issues.map((issue) => issue.code), [
    "UNSUPPORTED_NODE_TYPE",
    "BLEND_MODE_FALLBACK",
    "BLUR_EFFECT_FALLBACK",
    "VARIABLE_REFERENCE_MISSING",
    "ABSOLUTE_LAYOUT",
  ]);
});

test("target validation rejects nodes outside the imported document summary", (t) => {
  const imported = record(createHarmonyProject(t));
  assert.deepEqual(validateDesignTargets(imported, ["10:1", "10:1"]), ["10:1"]);
  assert.throws(() => validateDesignTargets(imported, ["999:1"]), (error) => error.code === "INVALID_ARGUMENT");
});

test("Figma node reads send the pinned version in the source request", async () => {
  let requestUrl;
  const adapter = new FigmaSourceAdapter({
    token: "figd_test",
    fetchImpl: async (input) => {
      requestUrl = new URL(input);
      return Response.json({ nodes: nodeFixture });
    },
  });
  const result = await adapter.getNodes(source, ["10:1"], undefined, "987654321");
  assert.equal(requestUrl.searchParams.get("version"), "987654321");
  assert.equal(requestUrl.searchParams.get("ids"), "10:1");
  assert.equal(result[0].id, "10:1");
});

test("analysis run persistence is deterministic, bounded, and project scoped", async (t) => {
  const stateRoot = tempRoot(t, "piora-design-runs-");
  const projectRoot = path.join(stateRoot, "project-a");
  const targetNodeIds = ["10:1"];
  const id = designAnalysisRunId(projectRoot, "imp_11111111111111111111", "987654321", targetNodeIds);
  const store = new DesignAnalysisRunStore(stateRoot);
  const run = {
    schemaVersion: 1,
    id,
    projectRoot,
    importId: "imp_11111111111111111111",
    sourceVersion: "987654321",
    targetNodeIds,
    status: "planned",
    revision: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  await store.save(run);
  assert.equal(id, designAnalysisRunId(projectRoot, run.importId, run.sourceVersion, ["10:1", "10:1"]));
  assert.equal(store.findCached(projectRoot, run.importId, run.sourceVersion, targetNodeIds).id, id);
  assert.equal(store.list(path.join(stateRoot, "project-b")).length, 0);
});

test("concurrent requests for the same deterministic run share one analysis", async (t) => {
  resetDesignAnalysisRunStoreForTests();
  t.after(() => resetDesignAnalysisRunStoreForTests());
  let calls = 0;
  const operation = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { id: "run_11111111111111111111" };
  };
  const [first, second] = await Promise.all([
    runDesignAnalysisOnce("run_11111111111111111111", operation),
    runDesignAnalysisOnce("run_11111111111111111111", operation),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.joined, false);
  assert.equal(second.joined, true);
  assert.equal(first.run, second.run);
});

test("analysis routes are bounded, versioned, cacheable, and project scoped", () => {
  const route = fs.readFileSync(new URL("../app/api/design-to-harmony/runs/route.ts", import.meta.url), "utf8");
  const itemRoute = fs.readFileSync(new URL("../app/api/design-to-harmony/runs/[id]/route.ts", import.meta.url), "utf8");
  assert.match(route, /readDesignJson/);
  assert.match(route, /validateDesignTargets/);
  assert.match(route, /findCached/);
  assert.match(route, /readFigmaAccessToken/);
  assert.match(itemRoute, /params: Promise/);
  assert.match(itemRoute, /designProjectPathsEqual/);
});
