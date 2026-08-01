import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, root));
}

function pngDimensions(buffer) {
  assert.deepEqual(
    [...buffer.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function icoSizes(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4);
  const sizes = [];

  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const width = buffer[entry] || 256;
    const height = buffer[entry + 1] || 256;
    const byteLength = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    assert.equal(width, height);
    assert.ok(byteLength > 0);
    assert.ok(offset + byteLength <= buffer.length);
    assert.deepEqual(
      [...buffer.subarray(offset, offset + 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );
    sizes.push(width);
  }

  return sizes;
}

test("the original piGUI mark is configured for Windows and web app surfaces", () => {
  const builder = read("desktop/electron-builder.yml").toString("utf8");
  assert.match(builder, /buildResources:\s*build/);
  assert.match(builder, /win:[\s\S]*?icon:\s*icon\.ico/);

  const icon = read("desktop/build/icon.ico");
  assert.deepEqual(icoSizes(icon), [16, 24, 32, 48, 64, 128, 256]);
  assert.deepEqual(read("app/favicon.ico"), icon);
  assert.deepEqual(pngDimensions(read("desktop/build/icon.png")), [1024, 1024]);
  assert.deepEqual(pngDimensions(read("public/icons/icon-192.png")), [192, 192]);
  assert.deepEqual(pngDimensions(read("public/icons/icon-512.png")), [512, 512]);
  assert.deepEqual(pngDimensions(read("public/icons/apple-touch-icon.png")), [180, 180]);

  const provenance = read("desktop/build/README.md").toString("utf8");
  assert.match(provenance, /original project asset/i);
  assert.match(provenance, /MIT License/);
  assert.match(provenance, /No Pi, pi-web, Codex, OpenAI/);
  assert.match(read("NOTICE").toString("utf8"), /application icon/);
});
