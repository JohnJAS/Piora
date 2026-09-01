import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { mergeCompanionRuntimePreferences } = await jiti.import("../lib/companion-preference-sync.ts");
const store = await jiti.import("../lib/companion-store.ts");
const runtime = await jiti.import("../lib/companion-runtime.ts");

test("companion mind model selection reconciles into main-window preferences", () => {
  const preferences = store.createDefaultCompanionPreferences();
  const runtimeState = runtime.createDefaultCompanionRuntimeState(10);
  runtimeState.settings.interactionModel = { provider: "openai-codex", modelId: "gpt-5.6" };
  runtimeState.settings.shareWorkContext = false;

  const merged = mergeCompanionRuntimePreferences(preferences, runtimeState);
  assert.deepEqual(merged.interactionModel, { provider: "openai-codex", modelId: "gpt-5.6" });
  assert.equal(merged.shareWorkContext, false);
  assert.equal(mergeCompanionRuntimePreferences(merged, runtimeState), merged);
});
