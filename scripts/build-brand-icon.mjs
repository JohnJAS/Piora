import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

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

export async function buildTrayIco(sourcePath, outputPath) {
  const images = await Promise.all([16, 24, 32, 48, 64, 128, 256].map(async size => ({
    size, bytes: await sharp(sourcePath).resize(size, size, { fit: "contain" }).png({ compressionLevel: 9 }).toBuffer(),
  })));
  await writeFile(outputPath, buildIco(images));
}

export async function buildBrandIcons(projectRoot, sourcePath, desktopDirectory = "desktop/build") {
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

await Promise.all([
  writePng(`${desktopDirectory}/icon.png`, 1024),
  writePng(`${desktopDirectory}/icon-transparent.png`, 1024),
  writePng("public/icons/icon-192.png", 192),
  writePng("public/icons/icon-512.png", 512),
  writePng("public/icons/apple-touch-icon.png", 180),
]);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoImages = await Promise.all(
  icoSizes.map(async (size) => ({ size, bytes: await renderPng(size) })),
);
const ico = buildIco(icoImages);
await writeFile(resolve(projectRoot, desktopDirectory, "icon.ico"), ico);
await writeFile(resolve(projectRoot, "app/favicon.ico"), ico);

return { source: sourcePath, pngSizes: [180, 192, 512, 1024], icoSizes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const projectRoot = resolve(import.meta.dirname, "..");
  console.log(JSON.stringify(await buildBrandIcons(projectRoot, resolve(projectRoot, "desktop/build/piora-icon.svg"))));
}
