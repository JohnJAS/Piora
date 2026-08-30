import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/models/route.ts", import.meta.url), "utf8");

test("model catalog failures remain actionable and can bypass stale cache", () => {
  assert.match(route, /searchParams\.get\("refresh"\) === "1"/);
  assert.match(route, /invalidateModelsCache\(\)/);
  assert.match(route, /Response\.json\(\{ \.\.\.EMPTY_MODELS, modelError: message \}\)/);
  assert.doesNotMatch(route, /catch \{\s*return Response\.json\(EMPTY_MODELS\)/);
});

test("an extension startup failure falls back to the core configured model catalog", () => {
  assert.match(route, /services = await createResponsiveModelServices\(cwd\)/);
  assert.match(route, /createTrustedModelServices\(cwd\)\.then/);
  assert.match(route, /services = await createCoreModelServices\(cwd\)/);
  assert.match(route, /Extension providers unavailable/);
  assert.match(route, /\[extensionLoadError, runtimeError\]\.filter\(Boolean\)/);
});
