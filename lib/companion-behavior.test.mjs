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
  assert.equal(behavior.pickCompanionInteractionStateId(["idle", "bounce"], "pet", null, () => 0), "bounce");
  assert.equal(behavior.isCompanionInteractionKind("feed"), true);
  assert.equal(behavior.isCompanionInteractionKind("started"), false);
});

test("speech lines come from the locale catalog and avoid immediate repeats", () => {
  const zhLines = behavior.listCompanionSpeechLines("poke", "zh-CN");
  assert.ok(zhLines.length > 0);
  assert.ok(zhLines.includes(behavior.pickCompanionSpeechLine("poke", "zh-CN")));
  assert.ok(behavior.listCompanionSpeechLines("idle", "en").includes(
    behavior.pickCompanionSpeechLine("idle", "en"),
  ));
  const feedLines = behavior.listCompanionSpeechLines("feed", "zh-CN");
  assert.notEqual(behavior.pickCompanionSpeechLine("feed", "zh-CN", feedLines[0], () => 0), feedLines[0]);
  const idleZh = behavior.listCompanionSpeechLines("idle", "zh-CN");
  assert.equal(behavior.pickCompanionSpeechLine("idle", "zh-CN", null, () => 0), idleZh[0]);
});

test("care needs decay over real time toward zero", () => {
  const start = 1_000_000;
  const fed = behavior.applyCompanionCareAction(
    { fedAt: 0, wateredAt: 0, pettedAt: 0 },
    "feed",
    start,
  );
  assert.deepEqual(fed, { fedAt: start, wateredAt: 0, pettedAt: 0 });

  const hungerDecay = behavior.COMPANION_CARE_DECAY_MS.hunger;
  assert.equal(behavior.getCompanionCareLevel("hunger", fed, start), 100);
  assert.equal(behavior.getCompanionCareLevel("hunger", fed, start + hungerDecay / 2), 50);
  assert.equal(behavior.getCompanionCareLevel("hunger", fed, start + hungerDecay), 0);
  assert.equal(behavior.getCompanionCareLevel("hunger", fed, start + hungerDecay * 3), 0);
  // A corrupt timestamp counts as "never", so at a realistic epoch the need is empty.
  const realNow = 1_770_000_000_000;
  assert.equal(behavior.getCompanionCareLevel("hunger", { ...fed, fedAt: Number.NaN }, realNow), 0);
});

test("care actions restore the matching need and poke leaves care untouched", () => {
  const start = 5_000;
  const timestamps = { fedAt: 0, wateredAt: 0, pettedAt: 0 };
  const after = behavior
    .applyCompanionCareAction(timestamps, "water", start);
  const afterPet = behavior.applyCompanionCareAction(after, "pet", start + 1);
  assert.equal(after.wateredAt, start);
  assert.equal(after.fedAt, 0);
  assert.equal(afterPet.pettedAt, start + 1);
  const poked = behavior.applyCompanionCareAction(afterPet, "poke", start + 2);
  assert.deepEqual(poked, afterPet);

  const levels = behavior.getCompanionCareLevels(
    { fedAt: start, wateredAt: start, pettedAt: start },
    start + 3.5 * 60 * 60 * 1000,
  );
  assert.deepEqual(behavior.listCompanionCareNeeds(levels), ["thirst"]);
  assert.equal(behavior.deriveCompanionCareMood({ hunger: 90, thirst: 80, affection: 75 }), "happy");
  assert.equal(behavior.deriveCompanionCareMood({ hunger: 45, thirst: 50, affection: 60 }), "content");
  assert.equal(behavior.deriveCompanionCareMood({ hunger: 20, thirst: 50, affection: 60 }), "uneasy");
  assert.equal(behavior.deriveCompanionCareMood({ hunger: 0, thirst: 0, affection: 0 }), "unhappy");
});

test("care timestamps sanitize junk input to a satisfied baseline", () => {
  const now = 123_456;
  assert.deepEqual(
    behavior.normalizeCompanionCareTimestamps({ fedAt: "x", wateredAt: -5 }, now),
    { fedAt: now, wateredAt: now, pettedAt: now },
  );
  assert.deepEqual(
    behavior.normalizeCompanionCareTimestamps({ fedAt: 42, wateredAt: 43, pettedAt: 44 }, now),
    { fedAt: 42, wateredAt: 43, pettedAt: 44 },
  );
});
