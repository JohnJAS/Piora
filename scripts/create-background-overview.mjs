import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const projectRoot = resolve(import.meta.dirname, "..");
const assetDirectory = resolve(projectRoot, "public", "themes", "dream-backgrounds");
const outputDirectory = resolve(projectRoot, "docs", "assets");
const outputPath = resolve(outputDirectory, "backgrounds-overview.webp");
const manifest = JSON.parse(readFileSync(resolve(assetDirectory, "manifest.json"), "utf8"));

const columns = 5;
const rows = 4;
const width = 384;
const height = 216;
const gap = 8;
const padding = 8;

if (!Array.isArray(manifest.presets) || manifest.presets.length !== columns * rows) {
  throw new Error(`Expected exactly ${columns * rows} background presets`);
}

const thumbnails = await Promise.all(manifest.presets.map(async (preset, index) => ({
  input: await sharp(resolve(assetDirectory, preset.asset.split("/").at(-1)))
    .resize(width, height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer(),
  left: padding + (index % columns) * (width + gap),
  top: padding + Math.floor(index / columns) * (height + gap),
})));

mkdirSync(outputDirectory, { recursive: true });
await sharp({
  create: {
    width: padding * 2 + columns * width + (columns - 1) * gap,
    height: padding * 2 + rows * height + (rows - 1) * gap,
    channels: 3,
    background: "#111418",
  },
})
  .composite(thumbnails)
  .webp({ quality: 86, effort: 6, smartSubsample: true })
  .toFile(outputPath);

console.log(`Wrote ${outputPath}`);
