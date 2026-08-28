import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const tsModuleCache = new Map();

function loadTypeScriptModule(relativePath) {
  const cached = tsModuleCache.get(relativePath);
  if (cached) return cached.exports;
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText;
  const loadedModule = { exports: {} };
  // Transpiled siblings import each other with extensionless "./name";
  // resolve those through this loader so runtime .ts imports keep working.
  const moduleRequire = (request) => {
    if (request.startsWith("./")) {
      const candidate = request.endsWith(".ts") ? request : `${request}.ts`;
      const sibling = path.posix.join(path.posix.dirname(relativePath), candidate);
      if (fs.existsSync(path.resolve(process.cwd(), sibling))) {
        return loadTypeScriptModule(sibling);
      }
    }
    return require(request);
  };
  Function("module", "exports", "require", output)(loadedModule, loadedModule.exports, moduleRequire);
  tsModuleCache.set(relativePath, loadedModule);
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

test("persistent task animation removes the legacy idle tail without changing custom timelines", () => {
  const idle = {
    id: "idle",
    frameIndices: [0, 1],
    durationsMs: [800, 1200],
    loopStart: 0,
  };
  const running = {
    id: "running",
    frameIndices: [8, 9, 8, 9, 8, 9, 0, 1],
    durationsMs: [100, 140, 100, 140, 100, 140, 800, 1200],
    loopStart: 6,
    fallback: "idle",
  };
  const prepared = companion.prepareCompanionPersistentAnimation(running, idle, "running");
  assert.deepEqual(prepared.frameIndices, [8, 9]);
  assert.deepEqual(prepared.durationsMs, [100, 140]);
  assert.equal(prepared.loopStart, 0);

  const review = companion.prepareCompanionPersistentAnimation({ ...running, id: "review" }, idle, "review");
  assert.deepEqual(review.frameIndices, running.frameIndices);
  assert.equal(review.loopStart, 0);

  const failed = companion.prepareCompanionPersistentAnimation({ ...running, id: "failed" }, idle, "failed");
  assert.equal(failed.id, "idle");
  assert.deepEqual(failed.frameIndices, idle.frameIndices);

  const custom = { ...running, id: "custom", loopStart: null };
  assert.equal(companion.prepareCompanionPersistentAnimation(custom, idle, "running"), custom);
});

test("transient companion events play one short action cycle then return to the base state", () => {
  const idle = { id: "idle", frameIndices: [0, 1], loopStart: 0 };
  const waving = {
    id: "waving",
    frameIndices: [24, 25, 24, 25, 24, 25, 0, 1],
    durationsMs: [120, 240, 120, 240, 120, 240, 800, 1200],
    loopStart: 6,
    fallback: "idle",
  };
  const transient = companion.prepareCompanionTransientAnimation(waving, idle, "running");
  assert.deepEqual(transient.frameIndices, [24, 25]);
  assert.deepEqual(transient.durationsMs, [120, 240]);
  assert.equal(transient.loopStart, null);
  assert.equal(transient.fallback, "running");
  assert.equal(companion.selectCompanionTransientSpriteState([idle, waving], "started"), waving);
  assert.equal(companion.selectCompanionTransientSpriteState([idle, waving], "completed"), waving);
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
  assert.equal(fallback.alwaysOnTop, true);
  assert.equal(fallback.version, 2);
  assert.equal(fallback.idleTricks, true);
  assert.equal(typeof fallback.care.fedAt, "number");
  assert.deepEqual(store.parseCompanionPreferences("not-json", fallback), fallback);

  const normalized = store.normalizeCompanionPreferences({
    version: 1,
    open: true,
    alwaysOnTop: false,
    selectedPetId: "../../escape",
    todos: [{ id: "bad id", text: "  ship it  ", completed: true, createdAt: 12 }],
    phrases: [{ id: "phrase:ok", label: " Test ", text: " Run tests " }, { label: "", text: "ignored" }],
  }, fallback);

  assert.equal(normalized.open, true);
  assert.equal(normalized.alwaysOnTop, false);
  assert.equal(normalized.selectedPetId, "builtin");
  assert.deepEqual(normalized.todos[0], { id: "todo:restored-1", text: "ship it", completed: true, createdAt: 12 });
  assert.deepEqual(normalized.phrases, [{ id: "phrase:ok", label: "Test", text: "Run tests" }]);
});

test("companion preferences v2 adds care state and migrates v1 data forward", () => {
  const fallback = store.createDefaultCompanionPreferences();

  const migrated = store.normalizeCompanionPreferences({
    version: 1,
    open: true,
    alwaysOnTop: true,
    selectedPetId: "dewey.codex-pet",
    todos: [{ id: "todo:1", text: "keep me", completed: false, createdAt: 7 }],
    phrases: [{ id: "phrase:1", label: "Hi", text: "Hello there" }],
  }, fallback);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.todos[0].text, "keep me");
  assert.equal(migrated.phrases[0].label, "Hi");
  assert.equal(migrated.idleTricks, true);
  assert.equal(typeof migrated.care.fedAt, "number");

  const care = { fedAt: 111, wateredAt: 222, pettedAt: 333 };
  const restored = store.normalizeCompanionPreferences({
    version: 2,
    open: false,
    alwaysOnTop: true,
    selectedPetId: "dewey.codex-pet",
    todos: [],
    phrases: [],
    care,
    idleTricks: false,
  }, fallback);
  assert.deepEqual(restored.care, care);
  assert.equal(restored.idleTricks, false);

  const sanitized = store.normalizeCompanionPreferences({
    version: 2,
    open: false,
    alwaysOnTop: true,
    selectedPetId: "x",
    todos: [],
    phrases: [],
    care: { fedAt: "nope", wateredAt: -1, pettedAt: 9 },
    idleTricks: true,
  }, fallback);
  assert.equal(sanitized.care.fedAt, sanitized.care.wateredAt);
  assert.equal(sanitized.care.pettedAt, 9);

  assert.equal(store.normalizeCompanionPreferences({ version: 3, open: true }, fallback), fallback);
});

test("interaction events select one-shot reaction animations", () => {
  const states = [{ id: "idle" }, { id: "waving" }, { id: "jumping" }, { id: "look-directions-b" }];
  assert.equal(companion.selectCompanionTransientSpriteState(states, "poke"), states[2]);
  assert.equal(companion.selectCompanionTransientSpriteState(states, "feed"), states[1]);
  assert.equal(companion.selectCompanionTransientSpriteState(states, "water"), states[1]);
  assert.equal(companion.selectCompanionTransientSpriteState(states, "pet"), states[1]);
  assert.equal(companion.selectCompanionTransientSpriteState(states, "trick"), states[1]);
  assert.equal(companion.selectCompanionTransientSpriteState([states[0]], "pet"), states[0]);
});
