import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const scopeSource = readFileSync(new URL("../lib/model-scope-settings.ts", import.meta.url), "utf8");
const testRouteSource = readFileSync(new URL("../app/api/models-config/test/route.ts", import.meta.url), "utf8");

test("separates Pi-native model visibility from custom config deletion", () => {
  assert.match(source, /fetch\("\/api\/models\/scope"/);
  assert.match(source, /"hide-provider"\s*\|\s*"restore-provider"/);
  assert.match(scopeSource, /interface EnabledModelsSettingsWriter/);
  assert.match(scopeSource, /setEnabledModels\(/);
  assert.match(source, /removeModel\(pName, i\)/);
  assert.match(source, /fetch\("\/api\/models-config"/);
});

test("separates provider visibility, credential removal, and custom deletion", () => {
  assert.match(source, /hiddenProviderIds/);
  assert.match(source, /models\.hiddenProviders/);
  assert.match(source, /updateModelScope\("hide-provider"/);
  assert.match(source, /updateModelScope\("restore-provider"/);
  assert.match(source, /api\/auth\/logout/);
  assert.match(source, /api\/auth\/api-key/);
  assert.match(source, /deleteProvider\(pName\)/);
});

test("serializes model-scope mutations and renders Pi diagnostics", () => {
  assert.match(source, /modelScopeMutationRef\.current/);
  assert.match(source, /if \(modelScopeMutationRef\.current\) return/);
  assert.match(source, /const scopeMutationBusy = modelScopeBusyKey !== null/);
  assert.match(source, /modelScope\.warnings\.map/);
  assert.match(source, /role=\{embedded \? "region" : "dialog"\}/);
  assert.match(source, /aria-modal=\{embedded \? undefined : true\}/);
});

test("offers a real availability test for draft and already-loaded models", () => {
  assert.match(source, /body:\s*JSON\.stringify\(\{ providerName, provider, model \}\)/);
  assert.match(source, /data-draft-model-test-actions/);
  assert.match(source, /models\.testRequiresId/);
  assert.match(source, /aria-label=\{t\("i18n\.testConnection"\)\}/);
  assert.match(source, /providerName:\s*model\.provider/);
  assert.match(source, /modelId:\s*model\.id/);
  assert.match(source, /data-model-test=\{testKey\}/);
  assert.match(source, /managedModelTests/);
  assert.match(source, /models\.testAvailable/);
  assert.match(source, /models\.testUnavailable/);
  assert.match(testRouteSource, /resolveModelRequestCwd/);
  assert.match(testRouteSource, /\(await createTrustedModelServices\(cwd\)\)\.modelRuntime/);
  assert.match(testRouteSource, /ModelRuntime\.create\(\{ modelsPath \}\)/);
});

test("saving a new custom model refreshes and restores it into the visible provider scope", () => {
  assert.match(source, /persistedConfiguredModelKeysRef/);
  assert.match(source, /const newlyConfiguredModels = configuredModels\.filter/);
  assert.match(source, /for \(const model of newlyConfiguredModels\) \{\s*await updateModelScope\("restore", model\);\s*\}/);
  assert.match(source, /persistedConfiguredModelKeysRef\.current = new Set\(\s*configuredModels\.map\(configuredModelKey\)/);
  assert.match(source, /onModelsChanged\?\.\(\)/);
});

test("adding a model selects its draft without nesting state updates", () => {
  assert.match(source, /const index = config\.providers\?\.\[providerName\]\?\.models\?\.length \?\? 0/);
  assert.match(source, /setSelection\(\{ type: "model", providerName, index \}\)/);
  const addModelBlock = source.match(/const addModel = useCallback[\s\S]*?\n  \}, \[config\.providers\]\);/)?.[0] ?? "";
  assert.ok(addModelBlock);
  assert.equal((addModelBlock.match(/setConfig\(/g) ?? []).length, 1);
});
