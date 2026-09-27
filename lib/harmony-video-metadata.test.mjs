import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { videoMetadataTransform } = await createJiti(import.meta.url).import("./harmony/media/video-metadata.ts");
test("video geometry parser preserves every byte across fragmented and adjacent packets", async () => {
  const packet = (type, body) => { const h = Buffer.alloc(8); h.writeUInt32BE(type); h.writeUInt32BE(body.length, 4); return Buffer.concat([h, body]); };
  const config = Buffer.alloc(13); config.writeUInt32BE(1080, 1); config.writeUInt32BE(2400, 5);
  const input = Buffer.concat([packet(2, config), packet(3, Buffer.alloc(30)), packet(3, Buffer.alloc(20))]);
  const configs = []; let frames = 0;
  const stream = new ReadableStream({ start(c) { for (const byte of input) c.enqueue(Uint8Array.of(byte)); c.close(); } });
  const output = [];
  for await (const chunk of stream.pipeThrough(videoMetadataTransform((w,h) => configs.push([w,h]), () => frames++))) output.push(chunk);
  assert.deepEqual(Buffer.concat(output), input); assert.deepEqual(configs, [[1080,2400]]); assert.equal(frames, 2);
});
