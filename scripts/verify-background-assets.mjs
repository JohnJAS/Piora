import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import sharp from "sharp";

const projectRoot = resolve(import.meta.dirname, "..");
const assetDirectory = resolve(projectRoot, "public", "themes", "dream-backgrounds");
const manifestPath = resolve(assetDirectory, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const failures = [];
const records = [];
const ids = new Set();
const assets = new Set();
const hashes = new Set();

if (manifest.schemaVersion !== 1) failures.push("manifest schemaVersion must be 1");
if (manifest.artworkStatus !== "complete") failures.push("manifest artworkStatus must be complete");
if (manifest.license !== "MIT") failures.push("manifest license must be MIT");
if (manifest.copyright !== "Copyright (c) 2026 Piora contributors") {
  failures.push("manifest copyright must identify Piora contributors");
}
if (
  manifest.provenance?.method
    !== "OpenAI image generation from original text prompts; no reference images supplied"
  || JSON.stringify(manifest.provenance?.records)
    !== JSON.stringify(["batch-a-generation.md", "batch-b-generation.md", "batch-c-generation.md", "batch-d-generation.md", "batch-e-generation.md"])
) {
  failures.push("manifest provenance must reference the committed generation records");
}
if (!Array.isArray(manifest.presets) || manifest.presets.length !== 37) {
  failures.push("manifest must contain exactly 37 presets");
}

for (const preset of manifest.presets ?? []) {
  if (ids.has(preset.id)) failures.push(`duplicate preset id: ${preset.id}`);
  ids.add(preset.id);

  if (preset.artworkStatus !== "available") {
    failures.push(`${preset.id}: artworkStatus must be available`);
  }
  if (typeof preset.asset !== "string"
    || !preset.asset.startsWith("/themes/dream-backgrounds/")
    || !preset.asset.endsWith(".webp")
    || preset.asset.includes("..")
    || preset.asset.includes("\\")) {
    failures.push(`${preset.id}: unsafe asset path`);
    continue;
  }

  const filename = basename(preset.asset);
  if (assets.has(filename)) failures.push(`duplicate asset filename: ${filename}`);
  assets.add(filename);

  const filePath = resolve(assetDirectory, filename);
  if (!existsSync(filePath)) {
    failures.push(`${preset.id}: missing ${filename}`);
    continue;
  }

  const bytes = readFileSync(filePath);
  if (bytes.length > 1.5 * 1024 * 1024) failures.push(`${filename}: exceeds 1.5 MiB`);
  if (bytes.subarray(0, 4).toString("ascii") !== "RIFF"
    || bytes.subarray(8, 12).toString("ascii") !== "WEBP") {
    failures.push(`${filename}: not a WebP file`);
    continue;
  }

  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "webp" || !metadata.width || !metadata.height) {
    failures.push(`${filename}: Sharp could not decode WebP dimensions`);
    continue;
  }
  if (metadata.width < 1600 || metadata.height < 900) {
    failures.push(`${filename}: expected at least 1600x900`);
  }
  const aspectRatio = metadata.width / metadata.height;
  if (Math.abs(aspectRatio - 16 / 9) > 0.01) {
    failures.push(`${filename}: expected a 16:9 aspect ratio`);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (hashes.has(sha256)) failures.push(`${filename}: duplicate image content`);
  hashes.add(sha256);
  records.push({ filename, width: metadata.width, height: metadata.height, bytes: bytes.length, sha256 });
}

const directoryWebps = readdirSync(assetDirectory)
  .filter((filename) => filename.endsWith(".webp"))
  .sort();
const declaredWebps = [...assets].sort();
if (JSON.stringify(directoryWebps) !== JSON.stringify(declaredWebps)) {
  failures.push("directory WebP files and manifest assets do not match exactly");
}

for (const recordFile of ["batch-a-generation.md", "batch-b-generation.md", "batch-c-generation.md", "batch-d-generation.md", "batch-e-generation.md", "README.md"]) {
  if (!existsSync(resolve(assetDirectory, recordFile))) failures.push(`missing ${recordFile}`);
}

if (failures.length) {
  console.error("Background verification failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  const totalBytes = records.reduce((total, record) => total + record.bytes, 0);
  console.log(`Verified ${records.length} unique WebP backgrounds (${totalBytes} bytes total).`);
  records
    .sort((left, right) => left.filename.localeCompare(right.filename))
    .forEach((record) => console.log(`${record.filename}: ${record.width}x${record.height}, ${record.bytes} bytes, ${record.sha256}`));
}
