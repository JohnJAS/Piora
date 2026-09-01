import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  FigmaSourceAdapter,
  normalizeFigmaDocumentSummary,
  normalizeFigmaVariables,
  parseFigmaSourceUrl,
} = await jiti.import("./design-to-harmony/figma-adapter.ts");
const {
  designCredentialStatus,
  readFigmaAccessToken,
  removeFigmaAccessToken,
  writeFigmaAccessToken,
} = await jiti.import("./design-to-harmony/credential-store.ts");
const { DesignImportStore } = await jiti.import("./design-to-harmony/import-store.ts");

const fixture = JSON.parse(fs.readFileSync(new URL("./design-to-harmony/fixtures/figma-multipage.json", import.meta.url), "utf8"));
const source = parseFigmaSourceUrl("https://www.figma.com/design/Abcdef123/Piora?node-id=10-1");
const variablesFixture = {
  meta: {
    variableCollections: {
      collection1: {
        key: "collection-key",
        name: "Theme",
        modes: [{ modeId: "mode-light", name: "Light" }, { modeId: "mode-dark", name: "Dark" }],
        variableIds: ["variable1", "variable2"],
      },
    },
    variables: {
      variable1: { key: "variable-key-1", name: "color/background", variableCollectionId: "collection1", resolvedType: "COLOR", remote: false },
      variable2: { key: "variable-key-2", name: "spacing/md", variableCollectionId: "collection1", resolvedType: "FLOAT", remote: false },
    },
  },
};

function tempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("accepts canonical Figma file links and rejects unsafe lookalikes", () => {
  assert.deepEqual(source, {
    provider: "figma",
    fileKey: "Abcdef123",
    nodeId: "10:1",
    url: "https://www.figma.com/design/Abcdef123/piora-design?node-id=10-1",
  });
  assert.equal(parseFigmaSourceUrl("https://figma.com/file/Abcdef123/name").fileKey, "Abcdef123");
  assert.throws(() => parseFigmaSourceUrl("http://www.figma.com/design/Abcdef123/name"));
  assert.throws(() => parseFigmaSourceUrl("https://figma.com.evil.example/design/Abcdef123/name"));
  assert.throws(() => parseFigmaSourceUrl("https://user:secret@figma.com/design/Abcdef123/name"));
  assert.throws(() => parseFigmaSourceUrl("https://www.figma.com/community/file/Abcdef123"));
});

test("normalizes a complete multi-page document into a bounded summary", () => {
  const variables = normalizeFigmaVariables(variablesFixture);
  const document = normalizeFigmaDocumentSummary(fixture, source, variables);

  assert.equal(document.name, "Piora Mobile App");
  assert.deepEqual(document.counts, {
    pages: 2,
    topLevelNodes: 3,
    components: 2,
    componentSets: 1,
    styles: 2,
    variables: 2,
    flows: 2,
  });
  assert.equal(document.pages[0].children[0].name, "Sign in");
  assert.equal(document.pages[1].children[0].children[0].type, "COMPONENT_SET");
  assert.equal(document.flows[0].pageId, "1:1");
  assert.equal(document.variables.collections[0].modes[1].name, "Dark");
  assert.match(document.warnings.join(" "), /targets one node/);
});

test("uses the private token header, a shallow file read, and graceful variable fallback", async () => {
  const requests = [];
  const fakeFetch = async (input, init) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (url.pathname.endsWith("/variables/local")) return new Response("{}", { status: 403 });
    return Response.json(fixture);
  };
  const adapter = new FigmaSourceAdapter({ token: "figd_private_token", fetchImpl: fakeFetch });
  const document = await adapter.getDocumentSummary(source);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.pathname, "/v1/files/Abcdef123");
  assert.equal(requests[0].url.searchParams.get("depth"), "2");
  assert.equal(new Headers(requests[0].init.headers).get("X-Figma-Token"), "figd_private_token");
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(document.variables.availability, "unavailable");
  assert.match(document.warnings[0], /file_variables:read/);
});

test("normalizes Figma rate-limit metadata without trusting arbitrary links", async () => {
  const adapter = new FigmaSourceAdapter({
    token: "figd_private_token",
    fetchImpl: async () => new Response("{}", {
      status: 429,
      headers: { "retry-after": "42", "x-figma-upgrade-link": "https://attacker.example/upgrade" },
    }),
  });
  await assert.rejects(
    () => adapter.getVariables(source),
    (error) => error.code === "SOURCE_RATE_LIMITED"
      && error.details.retryAfterSec === 42
      && !("upgradeUrl" in error.details),
  );
});

test("keeps Figma credentials private and never returns the secret in status", (t) => {
  const root = tempRoot(t, "piora-design-credentials-");
  const status = writeFigmaAccessToken("figd_private_token", root, new Date("2026-09-01T00:00:00Z"));

  assert.deepEqual(status, { provider: "figma", configured: true, updatedAt: "2026-09-01T00:00:00.000Z" });
  assert.equal(JSON.stringify(status).includes("figd_private_token"), false);
  assert.equal(readFigmaAccessToken(root), "figd_private_token");
  assert.equal(designCredentialStatus(root).configured, true);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(root, "credentials.json")).mode & 0o777, 0o600);
  assert.deepEqual(removeFigmaAccessToken(root), { provider: "figma", configured: false });
  assert.throws(() => readFigmaAccessToken(root), /Connect Figma/);
});

test("scopes import cache records to a project and preserves their newest version", async (t) => {
  const root = tempRoot(t, "piora-design-imports-");
  const store = new DesignImportStore(root);
  const document = normalizeFigmaDocumentSummary(fixture, source, normalizeFigmaVariables(variablesFixture));
  const makeRecord = (id, projectRoot, updatedAt) => ({
    schemaVersion: 1,
    id,
    projectRoot,
    source,
    document,
    importedAt: "2026-09-01T00:00:00.000Z",
    updatedAt,
  });
  await store.save(makeRecord("imp_11111111111111111111", path.join(root, "project-a"), "2026-09-01T00:00:01.000Z"));
  await store.save(makeRecord("imp_22222222222222222222", path.join(root, "project-b"), "2026-09-01T00:00:02.000Z"));
  await store.save(makeRecord("imp_11111111111111111111", path.join(root, "project-a"), "2026-09-01T00:00:03.000Z"));

  assert.equal(store.list().length, 2);
  assert.equal(store.list(path.join(root, "project-a")).length, 1);
  assert.equal(store.findCached(path.join(root, "project-a"), source).updatedAt, "2026-09-01T00:00:03.000Z");
  assert.equal(store.findCached(path.join(root, "missing"), source), undefined);
});

test("design routes enforce bounded JSON, allowed project roots, no-store responses, and project-scoped reads", () => {
  const shared = fs.readFileSync(new URL("../app/api/design-to-harmony/_shared.ts", import.meta.url), "utf8");
  const importsRoute = fs.readFileSync(new URL("../app/api/design-to-harmony/imports/route.ts", import.meta.url), "utf8");
  const importRoute = fs.readFileSync(new URL("../app/api/design-to-harmony/imports/[id]/route.ts", import.meta.url), "utf8");
  const connectRoute = fs.readFileSync(new URL("../app/api/design-to-harmony/sources/figma/connect/route.ts", import.meta.url), "utf8");

  assert.match(shared, /parseJsonWithinLimit/);
  assert.match(shared, /getAllowedFileRoots/);
  assert.match(shared, /private, no-store/);
  assert.match(importsRoute, /forceRefresh/);
  assert.match(importsRoute, /readFigmaAccessToken/);
  assert.match(importRoute, /params: Promise/);
  assert.match(importRoute, /designProjectPathsEqual/);
  assert.match(connectRoute, /designCredentialStatus/);
  assert.doesNotMatch(connectRoute, /readFigmaAccessToken/);
});
