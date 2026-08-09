import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
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

const companion = loadTypeScriptModule("lib/companion.ts");
const store = loadTypeScriptModule("lib/companion-store.ts");

test("companion activity mapping keeps review and failure distinct from running", () => {
  assert.equal(companion.deriveCompanionActivityStatus({}), "idle");
  assert.equal(companion.deriveCompanionActivityStatus({ isBusy: true, phase: "running_tools" }), "running");
  assert.equal(companion.deriveCompanionActivityStatus({ isBusy: true, phase: "waiting_model" }), "waiting");
  assert.equal(companion.deriveCompanionActivityStatus({ isBusy: true, hasReviewRequest: true }), "review");
  assert.equal(companion.deriveCompanionActivityStatus({ isBusy: true, error: "boom" }), "failed");
});

test("quick phrases can only send into an idle active chat", () => {
  assert.equal(companion.canSendCompanionPhrase("idle", true), true);
  assert.equal(companion.canSendCompanionPhrase("running", true), false);
  assert.equal(companion.canSendCompanionPhrase("idle", false), false);
});

test("sprite states map Codex V1/V2 rows with deterministic fallbacks", () => {
  const states = [{ id: "idle", row: 0 }, { id: "waving", row: 3 }, { id: "look-directions-a", row: 9 }];
  assert.equal(companion.selectCompanionSpriteState(states, "idle").row, 0);
  assert.equal(companion.selectCompanionSpriteState(states, "review").row, 3);
  assert.equal(companion.selectCompanionSpriteState(states, "waiting").row, 9);
  assert.deepEqual(companion.getCompanionFramePosition(8, 11, 7, 10), { xPercent: 100, yPercent: 100 });
  assert.deepEqual(companion.getCompanionFramePosition(8, 9, -3, 99), { xPercent: 0, yPercent: 100 });
});

test("custom animation metadata uses absolute atlas indices and normalized loops", () => {
  const custom = { frameIndices: [17, 3, 31], frames: 3, row: null };
  assert.deepEqual(companion.getCompanionAnimationFrameIndices(custom, 6, 36), [17, 3, 31]);
  assert.deepEqual(companion.getCompanionAtlasFramePosition(6, 6, 17), {
    xPercent: 100,
    yPercent: 40,
    column: 5,
    row: 2,
  });
  assert.equal(companion.advanceCompanionAnimation(0, 3, 1), 1);
  assert.equal(companion.advanceCompanionAnimation(2, 3, 1), 1);
  assert.equal(companion.advanceCompanionAnimation(2, 3, null), null);
});

test("legacy row animations remain a bounded read-only fallback", () => {
  assert.deepEqual(
    companion.getCompanionAnimationFrameIndices({ row: 2, frames: 4 }, 8, 72),
    [16, 17, 18, 19],
  );
  assert.deepEqual(
    companion.getCompanionAnimationFrameIndices({ frameIndices: [-1, 0, 99], row: 2, frames: 4 }, 8, 72),
    [0],
  );
});

test("companion preferences reject invalid JSON and sanitize bounded records", () => {
  const fallback = store.createDefaultCompanionPreferences([{ label: "Continue", text: "Continue." }]);
  assert.equal(fallback.selectedPetId, "pekka-pal.codex-pet");
  assert.deepEqual(store.parseCompanionPreferences("not-json", fallback), fallback);

  const normalized = store.normalizeCompanionPreferences({
    version: 1,
    open: true,
    selectedPetId: "../../escape",
    todos: [{ id: "bad id", text: "  ship it  ", completed: true, createdAt: 12 }],
    phrases: [{ id: "phrase:ok", label: " Test ", text: " Run tests " }, { label: "", text: "ignored" }],
  }, fallback);

  assert.equal(normalized.open, true);
  assert.equal(normalized.selectedPetId, "builtin");
  assert.deepEqual(normalized.todos[0], { id: "todo:restored-1", text: "ship it", completed: true, createdAt: 12 });
  assert.deepEqual(normalized.phrases, [{ id: "phrase:ok", label: "Test", text: "Run tests" }]);
});
