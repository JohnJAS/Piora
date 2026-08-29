import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const desktopMain = await readFile(join(repositoryRoot, "desktop", "src", "main.ts"), "utf8");
const splashGenerator = await readFile(join(repositoryRoot, "scripts", "generate-portable-splash.ps1"), "utf8");

function readBitmapPixel(buffer, x, y) {
  assert.equal(buffer.toString("ascii", 0, 2), "BM");
  const pixelOffset = buffer.readUInt32LE(10);
  const width = buffer.readInt32LE(18);
  const height = buffer.readInt32LE(22);
  const bitsPerPixel = buffer.readUInt16LE(28);
  assert.equal(bitsPerPixel, 32, "portable splash must stay a 32-bit bitmap");
  assert.ok(x >= 0 && x < width && y >= 0 && y < Math.abs(height));
  const storedY = height > 0 ? height - 1 - y : y;
  const offset = pixelOffset + (storedY * width + x) * 4;
  return [buffer[offset + 2], buffer[offset + 1], buffer[offset]];
}

test("Electron startup shell uses layered dark surfaces instead of a flat black fill", () => {
  assert.match(desktopMain, /STARTUP_SHELL_BACKGROUND = "#080a0f"/);
  assert.match(desktopMain, /name="theme-color" content="#080a0f"/);
  assert.match(desktopMain, /radial-gradient\(ellipse 58% 48%/);
  assert.match(desktopMain, /background-size:34px 34px/);
  assert.match(desktopMain, /backdrop-filter:blur\(28px\)/);
  assert.match(desktopMain, /box-shadow:0 38px 100px[\s\S]*inset 0 1px/);
  assert.match(desktopMain, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(desktopMain, /正在启动 Piora/);
  assert.match(desktopMain, /Starting Piora/);
});

test("portable pre-extraction splash is generated from the same layered visual language", () => {
  assert.match(splashGenerator, /LinearGradientBrush/);
  assert.match(splashGenerator, /#080A0F/);
  assert.match(splashGenerator, /#101522/);
  assert.match(splashGenerator, /New-RoundedRectanglePath/);
  assert.match(splashGenerator, /for \(\$x = 0; \$x -le 520; \$x \+= 26\)/);
  assert.match(splashGenerator, /STARTING PIORA/);
  assert.match(splashGenerator, /LOCAL-FIRST/);
});

test("committed portable splash contains visibly distinct background and panel layers", async () => {
  const bitmap = await readFile(join(repositoryRoot, "desktop", "build", "portable-splash.bmp"));
  assert.equal(bitmap.readInt32LE(18), 520);
  assert.equal(Math.abs(bitmap.readInt32LE(22)), 300);

  const outerTop = readBitmapPixel(bitmap, 8, 8);
  const outerBottom = readBitmapPixel(bitmap, 510, 290);
  const panelCenter = readBitmapPixel(bitmap, 260, 150);
  const panelTop = readBitmapPixel(bitmap, 260, 30);
  const colors = new Set([outerTop, outerBottom, panelCenter, panelTop].map((rgb) => rgb.join(",")));

  assert.ok(colors.size >= 4, `startup layers collapsed into too few colors: ${[...colors].join(" | ")}`);
  assert.ok(outerTop.some((channel) => channel > 8), "outer background must not be pure black");
  assert.notDeepEqual(panelCenter, outerTop, "raised startup panel must separate from the canvas");
});
