import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function loadTypeScriptModule(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const output = ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText;
  const loadedModule = { exports: {} };
  Function("module", "exports", "require", output)(loadedModule, loadedModule.exports, () => ({}));
  return loadedModule.exports;
}

const motion = loadTypeScriptModule("desktop/src/companion-motion.ts");

test("companion walking chooses available space and stays inside the work area", () => {
  const area = { x: 0, y: 0, width: 1000, height: 700 };
  const middle = { x: 400, y: 400, width: 156, height: 184 };
  assert.deepEqual(motion.planCompanionWalk(middle, area, 120, 2_000, "right"), {
    direction: "right",
    startX: 400,
    targetX: 520,
    distance: 120,
    durationMs: 2_000,
  });

  const atRightEdge = { ...middle, x: 844 };
  const reversed = motion.planCompanionWalk(atRightEdge, area, 200, 2_000, "right");
  assert.equal(reversed.direction, "left");
  assert.equal(reversed.targetX, 644);
  assert.equal(motion.companionMotionX(reversed, 0), 844);
  assert.equal(motion.companionMotionX(reversed, 2_000), 644);
});

test("companion dragging is clamped to the monitor work area", () => {
  const area = { x: -1000, y: 0, width: 1000, height: 800 };
  const start = { x: -300, y: 500, width: 156, height: 184 };
  assert.deepEqual(
    motion.dragCompanionBounds(start, { x: 10, y: 10 }, { x: 2000, y: 2000 }, area),
    { x: -156, y: 616, width: 156, height: 184 },
  );
  assert.deepEqual(
    motion.dragCompanionBounds(start, { x: 10, y: 10 }, { x: -2000, y: -2000 }, area),
    { x: -1000, y: 0, width: 156, height: 184 },
  );
});

test("walking progress eases deterministically without overshooting", () => {
  assert.equal(motion.companionMotionProgress(-10, 1_000), 0);
  assert.equal(motion.companionMotionProgress(500, 1_000), 0.5);
  assert.equal(motion.companionMotionProgress(2_000, 1_000), 1);
});
