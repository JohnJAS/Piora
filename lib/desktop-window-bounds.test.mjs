import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../desktop/src/window-bounds.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const commonJsModule = { exports: {} };
vm.runInNewContext(output, { module: commonJsModule, exports: commonJsModule.exports });
const { fitBoundsToVisibleDisplays } = commonJsModule.exports;

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const secondary = { x: 1920, y: -200, width: 2560, height: 1440 };

test("keeps a visible window on its existing display", () => {
  const bounds = { x: 2200, y: 20, width: 1200, height: 800 };
  assert.equal(fitBoundsToVisibleDisplays(bounds, [primary, secondary], primary, { width: 640, height: 480 }), bounds);
});

test("returns an off-screen window to the primary display after monitor removal", () => {
  const actual = fitBoundsToVisibleDisplays({ x: 2500, y: 100, width: 1400, height: 900 }, [primary], primary, { width: 640, height: 480 });
  assert.equal(JSON.stringify(actual), JSON.stringify({ x: 520, y: 100, width: 1400, height: 900 }));
});

test("shrinks oversized bounds to the available work area without violating visible minimums", () => {
  const actual = fitBoundsToVisibleDisplays({ x: -500, y: -300, width: 4000, height: 2000 }, [primary], primary, { width: 640, height: 480 });
  assert.equal(JSON.stringify(actual), JSON.stringify(primary));
});
