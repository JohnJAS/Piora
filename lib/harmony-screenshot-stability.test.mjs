import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  compareHarmonyScreenshotSamples,
  sampleHarmonyScreenshot,
} = await jiti.import("./harmony/screenshot-stability.ts");

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  output.write(type, 4, 4, "ascii");
  data.copy(output, 8);
  return output;
}

function rgbaPng(width, height, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const color = pixel(x, y);
      rows.set(color, row + 1 + x * 4);
    }
  }
  return {
    mimeType: "image/png",
    data: Buffer.concat([
      SIGNATURE,
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
    width,
    height,
  };
}

test("samples decoded PNG pixels and reports a bounded changed ratio", () => {
  const black = rgbaPng(4, 4, () => [0, 0, 0, 255]);
  const quarterWhite = rgbaPng(4, 4, (x, y) => x < 2 && y < 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  const baseline = sampleHarmonyScreenshot(black);
  const identical = compareHarmonyScreenshotSamples(baseline, sampleHarmonyScreenshot(black));
  const zeroThresholdIdentical = compareHarmonyScreenshotSamples(baseline, sampleHarmonyScreenshot(black), 0);
  const changed = compareHarmonyScreenshotSamples(baseline, sampleHarmonyScreenshot(quarterWhite));
  assert.equal(identical.changedRatio, 0);
  assert.equal(zeroThresholdIdentical.changedRatio, 0);
  assert.equal(changed.changedRatio, 0.25);
  assert.equal(changed.meanDelta, 63.75);
  assert.equal(changed.sampledPixels, 16);
});

test("supports a region that excludes unrelated screen motion", () => {
  const baseline = rgbaPng(4, 4, () => [0, 0, 0, 255]);
  const statusBarChanged = rgbaPng(4, 4, (_x, y) => y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255]);
  const region = { left: 0, top: 1, right: 4, bottom: 4 };
  const difference = compareHarmonyScreenshotSamples(
    sampleHarmonyScreenshot(baseline, { region }),
    sampleHarmonyScreenshot(statusBarChanged, { region }),
  );
  assert.equal(difference.changedRatio, 0);
});

test("rejects malformed PNGs and invalid regions", () => {
  assert.throws(
    () => sampleHarmonyScreenshot({ mimeType: "image/png", data: Buffer.from("not-png") }),
    /valid PNG/,
  );
  const screenshot = rgbaPng(2, 2, () => [0, 0, 0, 255]);
  assert.throws(
    () => sampleHarmonyScreenshot(screenshot, { region: { left: 0, top: 0, right: 3, bottom: 2 } }),
    /fit inside/,
  );
});
