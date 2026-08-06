import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const projectRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(projectRoot, "desktop/build/piora-icon.svg");
const svg = await readFile(sourcePath);

async function renderPng(size) {
  return sharp(svg, { density: 384 })
    .resize(size, size, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writePng(relativePath, size) {
  const outputPath = resolve(projectRoot, relativePath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await renderPng(size));
}

function buildIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const dataOffset = headerSize + entrySize * images.length;
  const header = Buffer.alloc(dataOffset);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = dataOffset;
  images.forEach(({ size, bytes }, index) => {
    const entryOffset = headerSize + index * entrySize;
    header.writeUInt8(size === 256 ? 0 : size, entryOffset);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(bytes.length, entryOffset + 8);
    header.writeUInt32LE(offset, entryOffset + 12);
    offset += bytes.length;
  });

  return Buffer.concat([header, ...images.map(({ bytes }) => bytes)]);
}

await Promise.all([
  writePng("desktop/build/icon.png", 1024),
  writePng("desktop/build/icon-transparent.png", 1024),
  writePng("public/icons/icon-192.png", 192),
  writePng("public/icons/icon-512.png", 512),
  writePng("public/icons/apple-touch-icon.png", 180),
]);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = await Promise.all(
  icoSizes.map(async (size) => ({ size, bytes: await renderPng(size) })),
);
const ico = buildIco(icoImages);
await writeFile(resolve(projectRoot, "desktop/build/icon.ico"), ico);
await writeFile(resolve(projectRoot, "app/favicon.ico"), ico);

console.log(JSON.stringify({
  brand: "Piora",
  source: sourcePath,
  pngSizes: [180, 192, 512, 1024],
  icoSizes,
}));
