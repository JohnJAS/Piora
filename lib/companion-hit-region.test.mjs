import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const {
  findCompanionAlphaHitRegion,
  fitCompanionHitRegion,
  padCompanionHitRegion,
} = await jiti.import("./companion-hit-region.ts");

test("companion alpha bounds follow the visible pixels instead of the whole frame", () => {
  const pixels = new Uint8ClampedArray(4 * 4 * 4);
  for (const [x, y] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
    pixels[(y * 4 + x) * 4 + 3] = 255;
  }
  assert.deepEqual(findCompanionAlphaHitRegion(pixels, 4, 4), {
    left: 0.25,
    top: 0.25,
    width: 0.5,
    height: 0.5,
  });
});

test("companion hit bounds ignore nearly transparent pixels and stay usable", () => {
  const pixels = new Uint8ClampedArray(10 * 10 * 4);
  pixels[3] = 8;
  pixels[(5 * 10 + 5) * 4 + 3] = 255;
  const visible = findCompanionAlphaHitRegion(pixels, 10, 10);
  assert.deepEqual(visible, { left: 0.5, top: 0.5, width: 0.1, height: 0.1 });
  const padded = padCompanionHitRegion(visible, 0, 0.2, 0.16);
  assert.equal(padded.width, 0.2);
  assert.equal(padded.height, 0.16);
});

test("companion hit bounds account for contain fitting", () => {
  const fitted = fitCompanionHitRegion({ left: 0, top: 0, width: 1, height: 1 }, 200, 100, 1);
  assert.deepEqual(fitted, { left: 0, top: 0.25, width: 1, height: 0.5 });
});
