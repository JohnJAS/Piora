import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { normalizeDesignNodes } = await jiti.import("./design-to-harmony/normalize.ts");
const { OCTO_JSON_MAX_BYTES, OctoSourceAdapter, OctoSourceStore, octoSourceRef } = await jiti.import("./design-to-harmony/octo-adapter.ts");

const octoDesign = {
  type: "FRAME",
  id: "33:943",
  name: "Medication settings",
  x: 0,
  y: 0,
  width: 360,
  height: 792,
  layoutMode: "VERTICAL",
  itemSpacing: 12,
  children: [
    {
      type: "TEXT",
      id: "33:944",
      name: "Title",
      x: 24,
      y: 40,
      width: 220,
      height: 28,
      characters: "Medication",
      style: { "font-size": "20px", "line-height": "28px", color: "#112233" },
      textData: { text: [{ characters: "Medication", fontFamily: "HarmonyHeiTi", fontWeight: 600 }] },
      children: [],
    },
    {
      type: "COMPONENT",
      id: "33:945",
      name: "Primary button",
      x: 24,
      y: 100,
      width: 312,
      height: 48,
      styleData: { fill: [{ styleGuid: "style:primary", name: "Brand/Primary", type: "fill" }] },
      children: [],
    },
  ],
};

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-octo-source-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("imports Octo JSON as a private structural source and summarizes the complete document", async (t) => {
  const root = tempRoot(t);
  const store = new OctoSourceStore(root);
  const stored = store.importJson(JSON.stringify(octoDesign), "medication.octo.json", new Date("2026-09-02T00:00:00Z"));
  const ref = octoSourceRef(stored);
  const adapter = new OctoSourceAdapter({ root });
  const summary = await adapter.getDocumentSummary(ref);

  assert.equal(ref.provider, "octo");
  assert.equal(ref.transport, "file");
  assert.equal(ref.originalFileName, "medication.octo.json");
  assert.equal(summary.name, "Medication settings");
  assert.deepEqual(summary.counts, {
    pages: 1,
    topLevelNodes: 1,
    components: 1,
    componentSets: 0,
    styles: 1,
    variables: 0,
    flows: 1,
  });
  assert.equal(summary.pages[0].children[0].id, "33:943");
  assert.match(summary.warnings.join(" "), /structurally/i);
  assert.equal(fs.existsSync(path.join(root, "sources", "octo", `${stored.fileKey}.json`)), true);
});

test("normalizes Octo coordinates and text runs into the existing Design IR", async (t) => {
  const root = tempRoot(t);
  const stored = new OctoSourceStore(root).importJson(JSON.stringify(octoDesign), "medication.json");
  const ref = octoSourceRef(stored);
  const payloads = await new OctoSourceAdapter({ root }).getNodes(ref, ["33:943"], undefined, stored.version.id);
  const ir = normalizeDesignNodes({
    sourceImportId: "imp_11111111111111111111",
    sourceVersion: stored.version.id,
    targetNodeIds: ["33:943"],
    payloads,
  });

  assert.equal(ir.roots[0].layout.mode, "column");
  assert.equal(ir.roots[0].layout.width, 360);
  assert.equal(ir.roots[0].children[0].layout.x, 24);
  assert.equal(ir.roots[0].children[0].text.characters, "Medication");
  assert.equal(ir.roots[0].children[0].text.fontFamily, "HarmonyHeiTi");
  assert.equal(ir.roots[0].children[0].text.fontSize, 20);
  assert.equal(ir.roots[0].children[0].fills[0].color.red, 0x11 / 255);
});

test("accepts Octo's native content/key/box/style export shape", async (t) => {
  const root = tempRoot(t);
  const native = {
    assets: [],
    content: [{
      key: "native:1",
      name: "Native page",
      type: "FRAME",
      box: { x: 0, y: 0, width: 390, height: 844 },
      style: { flex_direction: "column", gap: 16, background_color: { type: "color", red: 255, green: 255, blue: 255, alpha: 1 } },
      children: [{
        key: "native:2",
        name: "Heading",
        type: "TEXT",
        box: { x: 20, y: 30, width: 240, height: 32 },
        style: { font_size: 24, font_weight: 700, line_height: 32, font_family: "HarmonyHeiTi", font_color: { red: 17, green: 34, blue: 51, alpha: 1 } },
        content: "Native Octo",
      }],
    }],
  };
  const stored = new OctoSourceStore(root).importJson(JSON.stringify(native), "native.json");
  const payload = await new OctoSourceAdapter({ root }).getNodes(octoSourceRef(stored), ["native:1"]);
  const ir = normalizeDesignNodes({ sourceImportId: "imp_22222222222222222222", sourceVersion: stored.version.id, targetNodeIds: ["native:1"], payloads: payload });

  assert.equal(ir.roots[0].layout.width, 390);
  assert.equal(ir.roots[0].layout.mode, "column");
  assert.equal(ir.roots[0].children[0].text.characters, "Native Octo");
  assert.equal(ir.roots[0].children[0].text.fontWeight, 700);
  assert.equal(ir.roots[0].children[0].fills[0].color.green, 34 / 255);
});

test("pins Octo analysis to the imported content hash and uses explicit asset fallbacks", async (t) => {
  const root = tempRoot(t);
  const stored = new OctoSourceStore(root).importJson(JSON.stringify(octoDesign), "medication.json");
  const ref = octoSourceRef(stored);
  const adapter = new OctoSourceAdapter({ root });

  assert.deepEqual(await adapter.getVersion(ref), stored.version);
  await assert.rejects(() => adapter.getNodes(ref, ["33:943"], undefined, "older-version"), (error) => error.code === "SOURCE_VERSION_CHANGED");
  assert.deepEqual(await adapter.exportAssets(ref, [{ nodeId: "33:945", format: "png" }]), [{ nodeId: "33:945", url: null }]);
  assert.deepEqual(await adapter.renderReference(ref, ["33:943"]), [{ nodeId: "33:943", url: null }]);
});

test("keeps identical Octo imports immutable and rejects overly deep native trees", (t) => {
  const store = new OctoSourceStore(tempRoot(t));
  const text = JSON.stringify(octoDesign);
  const first = store.importJson(text, "first.json", new Date("2026-09-02T00:00:00Z"));
  const repeated = store.importJson(text, "renamed.json", new Date("2026-09-03T00:00:00Z"));
  assert.deepEqual(repeated, first);

  const root = { key: "deep:0", type: "FRAME", box: {}, children: [] };
  let cursor = root;
  for (let index = 1; index <= 130; index += 1) {
    const child = { key: `deep:${index}`, type: "FRAME", box: {}, children: [] };
    cursor.children.push(child);
    cursor = child;
  }
  assert.throws(
    () => store.importJson(JSON.stringify({ content: [root] }), "deep.json"),
    (error) => error.code === "SOURCE_INVALID_RESPONSE" && /deep/i.test(error.message),
  );
});

test("rejects malformed, duplicate, and oversized Octo exports before persistence", (t) => {
  const store = new OctoSourceStore(tempRoot(t));
  assert.throws(() => store.importJson("not json", "bad.json"), (error) => error.code === "SOURCE_INVALID_RESPONSE");
  assert.throws(() => store.importJson(JSON.stringify({ ...octoDesign, children: [{ id: "same", type: "FRAME" }, { id: "same", type: "FRAME" }] }), "duplicates.json"), /duplicate node id/);
  assert.throws(() => store.importJson("x".repeat(OCTO_JSON_MAX_BYTES + 1), "large.json"), (error) => error.code === "SOURCE_RESPONSE_TOO_LARGE");
});

test("Octo upload and downstream routes use bounded multipart input and the shared adapter factory", () => {
  const route = fs.readFileSync(new URL("../app/api/design-to-harmony/imports/octo/route.ts", import.meta.url), "utf8");
  const analysisRoute = fs.readFileSync(new URL("../app/api/design-to-harmony/runs/route.ts", import.meta.url), "utf8");
  const generationRoute = fs.readFileSync(new URL("../app/api/design-to-harmony/runs/[id]/generate/route.ts", import.meta.url), "utf8");
  const validation = fs.readFileSync(new URL("./design-to-harmony/validation-service.ts", import.meta.url), "utf8");

  assert.match(route, /parseFormDataWithinLimit/);
  assert.match(route, /OCTO_JSON_MAX_BYTES/);
  assert.match(route, /TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(route, /validateDesignProjectRoot/);
  assert.match(analysisRoute, /createDesignSourceAdapter\(record\.source\)/);
  assert.match(generationRoute, /createDesignSourceAdapter\(designImport\.source\)/);
  assert.match(validation, /createDesignSourceAdapter\(designImport\.source\)/);
});
