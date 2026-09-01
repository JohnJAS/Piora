import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { analyzeDesignSelection } = await jiti.import("./design-to-harmony/analysis.ts");
const { DesignProjectApplyService } = await jiti.import("./design-to-harmony/apply-service.ts");
const { consumeDesignApplyToken, issueDesignApplyToken, resetDesignApplyTokensForTests } = await jiti.import("./design-to-harmony/apply-token-store.ts");
const { normalizeFigmaDocumentSummary, normalizeFigmaVariables, parseFigmaSourceUrl } = await jiti.import("./design-to-harmony/figma-adapter.ts");
const { DesignManagedStateStore } = await jiti.import("./design-to-harmony/managed-state-store.ts");
const { buildDesignPatchSet } = await jiti.import("./design-to-harmony/patch-builder.ts");
const { DesignPreviewWorkspace } = await jiti.import("./design-to-harmony/preview-workspace.ts");
const { analyzeHarmonyProject } = await jiti.import("./design-to-harmony/project-analyzer.ts");

const documentFixture = JSON.parse(fs.readFileSync(new URL("./design-to-harmony/fixtures/figma-multipage.json", import.meta.url), "utf8"));
const rawNodeFixture = JSON.parse(fs.readFileSync(new URL("./design-to-harmony/fixtures/figma-analysis-nodes.json", import.meta.url), "utf8"));
const nodeFixture = structuredClone(rawNodeFixture);
nodeFixture["10:1"].document.children = nodeFixture["10:1"].document.children.filter((node) => node.type !== "WIDGET");
const source = parseFigmaSourceUrl("https://www.figma.com/design/Abcdef123/Piora");
const variables = normalizeFigmaVariables({ meta: { variableCollections: {}, variables: {} } });

function tempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

async function fixture(t, options = {}) {
  const projectRoot = tempRoot(t, "piora-apply-project-");
  const dataRoot = tempRoot(t, "piora-apply-data-");
  const components = path.join(projectRoot, "entry", "src", "main", "ets", "components");
  fs.mkdirSync(components, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "entry", "src", "main", "resources"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "entry", "src", "main", "module.json5"), "{ module: { name: 'entry' } }\n");
  fs.writeFileSync(path.join(components, "Button.ets"), "@Component\nexport struct Button {}\n");
  const record = {
    schemaVersion: 1,
    id: "imp_11111111111111111111",
    projectRoot,
    source,
    document: normalizeFigmaDocumentSummary(documentFixture, source, variables),
    importedAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  };
  const adapter = { async getNodes(_source, ids) { return ids.flatMap((id) => nodeFixture[id] ? [{ id, document: nodeFixture[id].document }] : []); } };
  const { ir, plan } = await analyzeDesignSelection({ record, targetNodeIds: ["10:1"], adapter, project: analyzeHarmonyProject(projectRoot) });
  const workspace = new DesignPreviewWorkspace(dataRoot);
  const preview = workspace.generate("run_11111111111111111111", ir, plan);
  const run = {
    schemaVersion: 1,
    id: preview.runId,
    projectRoot,
    importId: record.id,
    sourceVersion: ir.sourceVersion,
    targetNodeIds: ir.targetNodeIds,
    status: "generated",
    revision: 3,
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:01.000Z",
    plan,
    preview: { id: preview.id, manifestHash: preview.hash, generatorVersion: preview.generatorVersion, artifactCount: preview.artifacts.length, totalBytes: preview.totalBytes, generatedAt: "2026-09-02T00:00:01.000Z" },
  };
  const managedStore = new DesignManagedStateStore(dataRoot);
  const service = new DesignProjectApplyService({ dataRoot, workspace, managedStore, ...options });
  return { projectRoot, dataRoot, workspace, preview, run, managedStore, service };
}

function writeRecoveryJournal(service, journal) {
  const directory = path.join(service.transactionRoot, journal.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "journal.json"), `${JSON.stringify(journal, null, 2)}\n`);
}

test("review builds a complete deterministic patch without touching the project", async (t) => {
  const { projectRoot, workspace, preview, run, managedStore } = await fixture(t);
  const before = fs.readdirSync(projectRoot, { recursive: true }).map(String).sort();
  const first = buildDesignPatchSet({ run, preview, workspace, managedStore });
  const second = buildDesignPatchSet({ run, preview, workspace, managedStore });
  assert.deepEqual(first, second);
  assert.equal(first.canApply, true);
  assert.equal(first.stats.additions, 2);
  assert.equal(first.stats.conflicts, 0);
  assert.equal(first.files.every((file) => file.patch.includes("diff --git") && file.patch.includes("--- /dev/null")), true);
  assert.deepEqual(fs.readdirSync(projectRoot, { recursive: true }).map(String).sort(), before);
});

test("apply writes every artifact, records managed ownership, and becomes a no-op on repeat", async (t) => {
  const { projectRoot, workspace, preview, run, managedStore, service } = await fixture(t);
  const reviewed = buildDesignPatchSet({ run, preview, workspace, managedStore });
  const output = await service.apply({ run, preview, expectedPatchHash: reviewed.hash, overwritePaths: [] });
  assert.equal(output.applied.appliedPaths.length, preview.artifacts.length);
  for (const artifact of preview.artifacts) {
    const target = path.join(projectRoot, ...artifact.relativePath.split("/"));
    assert.equal(fs.existsSync(target), true);
    assert.equal(fs.readFileSync(target, "utf8"), workspace.readFile(run.id, preview.id, artifact.relativePath).content);
  }
  const managed = managedStore.get(projectRoot);
  assert.equal(managed.revision, 1);
  assert.equal(managed.files.length, preview.artifacts.length);
  assert.equal(managed.files.every((file) => file.mode === "managed"), true);
  const repeated = buildDesignPatchSet({ run, preview, workspace, managedStore });
  assert.equal(repeated.stats.unchanged, preview.artifacts.length);
  assert.equal(repeated.canApply, false);
});

test("manual edits conflict, explicit managed overwrite succeeds, and detached files stay protected", async (t) => {
  const { projectRoot, workspace, preview, run, managedStore, service } = await fixture(t);
  const initial = buildDesignPatchSet({ run, preview, workspace, managedStore });
  await service.apply({ run, preview, expectedPatchHash: initial.hash, overwritePaths: [] });
  const codeArtifact = preview.artifacts.find((artifact) => artifact.kind === "arkts");
  const target = path.join(projectRoot, ...codeArtifact.relativePath.split("/"));
  fs.appendFileSync(target, "// manual change\n");
  const conflicted = buildDesignPatchSet({ run, preview, workspace, managedStore });
  const conflict = conflicted.files.find((file) => file.relativePath === codeArtifact.relativePath);
  assert.equal(conflict.change, "conflict");
  assert.equal(conflict.conflictCode, "managed_modified");
  assert.equal(conflict.overwriteAllowed, true);
  await assert.rejects(service.apply({ run, preview, expectedPatchHash: conflicted.hash, overwritePaths: [] }), (error) => error.code === "APPLY_BLOCKED");
  await service.apply({ run, preview, expectedPatchHash: conflicted.hash, overwritePaths: [codeArtifact.relativePath] });
  assert.doesNotMatch(fs.readFileSync(target, "utf8"), /manual change/);

  const state = managedStore.get(projectRoot);
  await managedStore.setMode(projectRoot, codeArtifact.relativePath, "detached", state.revision);
  fs.appendFileSync(target, "// user owns this now\n");
  const detached = buildDesignPatchSet({ run, preview, workspace, managedStore });
  const detachedConflict = detached.files.find((file) => file.relativePath === codeArtifact.relativePath);
  assert.equal(detachedConflict.conflictCode, "detached_file");
  assert.equal(detachedConflict.overwriteAllowed, false);
});

test("a multi-file failure rolls every project write back", async (t) => {
  const context = await fixture(t, { afterCommitForTests(_relativePath, index) { if (index === 0) throw new Error("injected failure"); } });
  const reviewed = buildDesignPatchSet({ run: context.run, preview: context.preview, workspace: context.workspace, managedStore: context.managedStore });
  await assert.rejects(context.service.apply({ run: context.run, preview: context.preview, expectedPatchHash: reviewed.hash, overwritePaths: [] }), (error) => error.code === "APPLY_FAILED");
  for (const artifact of context.preview.artifacts) {
    assert.equal(fs.existsSync(path.join(context.projectRoot, ...artifact.relativePath.split("/"))), false);
  }
  assert.equal(context.managedStore.get(context.projectRoot).revision, 0);
  const leftovers = fs.readdirSync(context.projectRoot, { recursive: true }).map(String).filter((entry) => entry.includes(".piora-design-"));
  assert.deepEqual(leftovers, []);
});

test("restart recovery rolls back a transaction interrupted while committing", async (t) => {
  const { projectRoot, workspace, preview, run, managedStore, service } = await fixture(t);
  const artifact = preview.artifacts[0];
  const previewFile = workspace.readFile(run.id, preview.id, artifact.relativePath);
  const target = path.join(projectRoot, ...artifact.relativePath.split("/"));
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(target, previewFile.content);
  const id = "apply_1234567890abcdef1234";
  writeRecoveryJournal(service, {
    schemaVersion: 1,
    id,
    projectRoot,
    state: "committing",
    expectedManagedRevision: 0,
    createdDirectories: [],
    operations: [{
      relativePath: artifact.relativePath,
      targetPath: target,
      temporaryPath: path.join(directory, `.piora-design-apply-${id}-recovery.tmp`),
      backupPath: path.join(directory, `.piora-design-backup-${id}-recovery.tmp`),
      currentExists: false,
      previewSha256: artifact.sha256,
      mode: 0o644,
      committed: true,
    }],
    nextManagedFiles: [],
  });
  await service.recover(projectRoot);
  assert.equal(fs.existsSync(target), false);
  assert.equal(managedStore.get(projectRoot).revision, 0);
  assert.equal(fs.existsSync(path.join(service.transactionRoot, id)), false);
});

test("restart recovery finalizes managed state after all files were committed", async (t) => {
  const { projectRoot, workspace, preview, run, managedStore, service } = await fixture(t);
  const artifact = preview.artifacts[0];
  const previewFile = workspace.readFile(run.id, preview.id, artifact.relativePath);
  const target = path.join(projectRoot, ...artifact.relativePath.split("/"));
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(target, previewFile.content);
  const id = "apply_abcdef12345678901234";
  const appliedAt = "2026-09-02T00:00:02.000Z";
  const managedFile = {
    relativePath: artifact.relativePath,
    mode: "managed",
    sourceImportId: run.importId,
    sourceVersion: run.sourceVersion,
    planId: preview.planId,
    previewId: preview.id,
    generatorVersion: preview.generatorVersion,
    sourceNodeIds: artifact.sourceNodeIds,
    appliedSha256: artifact.sha256,
    appliedAt,
  };
  writeRecoveryJournal(service, {
    schemaVersion: 1,
    id,
    projectRoot,
    state: "files_committed",
    expectedManagedRevision: 0,
    createdDirectories: [],
    operations: [{
      relativePath: artifact.relativePath,
      targetPath: target,
      temporaryPath: path.join(directory, `.piora-design-apply-${id}-recovery.tmp`),
      backupPath: path.join(directory, `.piora-design-backup-${id}-recovery.tmp`),
      currentExists: false,
      previewSha256: artifact.sha256,
      mode: 0o644,
      committed: true,
    }],
    nextManagedFiles: [managedFile],
  });
  await service.recover(projectRoot);
  assert.equal(fs.readFileSync(target, "utf8"), previewFile.content);
  const managed = managedStore.get(projectRoot);
  assert.equal(managed.revision, 1);
  assert.deepEqual(managed.files, [managedFile]);
  assert.equal(fs.existsSync(path.join(service.transactionRoot, id)), false);
});

test("stale patches and replayed apply tokens fail closed", async (t) => {
  resetDesignApplyTokensForTests();
  const { projectRoot, workspace, preview, run, managedStore, service } = await fixture(t);
  const reviewed = buildDesignPatchSet({ run, preview, workspace, managedStore });
  const firstArtifact = preview.artifacts[0];
  const target = path.join(projectRoot, ...firstArtifact.relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "user file\n");
  await assert.rejects(service.apply({ run, preview, expectedPatchHash: reviewed.hash, overwritePaths: [] }), (error) => error.code === "PATCH_STALE");

  const issued = issueDesignApplyToken({ runId: run.id, projectRoot, expectedRevision: 4, patchHash: reviewed.hash, overwritePaths: [] });
  const consumed = consumeDesignApplyToken({ token: issued.token, runId: run.id, projectRoot, expectedRevision: 4, patchHash: reviewed.hash });
  assert.equal(consumed.runId, run.id);
  assert.throws(() => consumeDesignApplyToken({ token: issued.token, runId: run.id, projectRoot, expectedRevision: 4, patchHash: reviewed.hash }), (error) => error.code === "APPLY_TOKEN_INVALID");
});

test("review and apply routes bind project scope, revision, patch hash, and apply token", () => {
  const review = fs.readFileSync(new URL("../app/api/design-to-harmony/runs/[id]/review/route.ts", import.meta.url), "utf8");
  const token = fs.readFileSync(new URL("../app/api/design-to-harmony/runs/[id]/apply-token/route.ts", import.meta.url), "utf8");
  const apply = fs.readFileSync(new URL("../app/api/design-to-harmony/runs/[id]/apply/route.ts", import.meta.url), "utf8");
  const management = fs.readFileSync(new URL("../app/api/design-to-harmony/runs/[id]/management/route.ts", import.meta.url), "utf8");
  for (const source of [review, token, apply, management]) {
    assert.match(source, /designProjectPathsEqual/);
    assert.match(source, /params: Promise/);
    assert.match(source, /runtime = "nodejs"/);
  }
  assert.match(token, /issueDesignApplyToken/);
  assert.match(apply, /consumeDesignApplyToken/);
  assert.match(apply, /runDesignApplyExclusive/);
  assert.match(management, /expectedManagedRevision/);
});
