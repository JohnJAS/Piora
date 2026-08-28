import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function loadTypeScriptModule(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText;
  const loadedModule = { exports: {} };
  Function("module", "exports", "require", output)(loadedModule, loadedModule.exports, require);
  return loadedModule.exports;
}

const behavior = loadTypeScriptModule("lib/companion-behavior.ts");

test("reaction state picking stays inside the sprite and avoids repeats", () => {
  const states = ["idle", "waving", "jumping"];
  assert.equal(behavior.pickCompanionReactionStateId(states, ["jumping", "waving"], null, () => 0), "jumping");
  assert.equal(behavior.pickCompanionReactionStateId(states, ["jumping", "waving"], "jumping", () => 0), "waving");
  assert.equal(behavior.pickCompanionReactionStateId(states, ["waving"], "waving"), "waving");
  assert.equal(behavior.pickCompanionReactionStateId(states, ["running"], null), null);
  assert.equal(behavior.pickCompanionIdleTrickStateId(["idle"], null), null);
  assert.equal(behavior.pickCompanionIdleTrickStateId(["idle", "spin"], "spin", () => 0), "spin");
  assert.equal(behavior.pickCompanionInteractionStateId(["idle", "bounce"], "poke", null, () => 0), "bounce");
  assert.equal(behavior.isCompanionInteractionKind("feed"), false);
  assert.equal(behavior.isCompanionInteractionKind("poke"), true);
  assert.equal(behavior.isCompanionInteractionKind("started"), false);
});

test("agent runtime phases map to visible pet behavior without guessing", () => {
  assert.deepEqual(behavior.deriveCompanionTaskPresentation({
    runtime: "running",
    pendingApproval: false,
    lastPromptFailed: false,
    activity: { kind: "tool", message: "Reading files", updatedAt: 1 },
  }), { status: "running", activityKind: "tool" });
  assert.deepEqual(behavior.deriveCompanionTaskPresentation({
    runtime: "running",
    pendingApproval: false,
    lastPromptFailed: false,
    activity: { kind: "thinking", message: "Thinking", updatedAt: 1 },
  }), { status: "waiting", activityKind: "thinking" });
  assert.deepEqual(behavior.deriveCompanionTaskPresentation({
    runtime: "idle",
    pendingApproval: true,
    lastPromptFailed: false,
  }), { status: "review", activityKind: "review" });
  assert.deepEqual(behavior.deriveCompanionTaskPresentation({
    runtime: "idle",
    pendingApproval: false,
    lastPromptFailed: true,
  }), { status: "failed", activityKind: "failed" });
  assert.equal(behavior.getCompanionWanderDelay(() => 0), behavior.COMPANION_WANDER_MIN_DELAY_MS);
  assert.equal(
    behavior.getCompanionWanderDelay(() => 1),
    behavior.COMPANION_WANDER_MIN_DELAY_MS + behavior.COMPANION_WANDER_EXTRA_DELAY_MS,
  );
});
