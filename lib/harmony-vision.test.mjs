import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { analyzeHarmonyScreenshot } = await jiti.import("./harmony/vision.ts");
const vision = { enabled: true, provider: "test", modelId: "vision" };

function png(width, height, size = 24) {
  const data = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

test("rejects malformed and oversized vision screenshots before loading a model runtime", async () => {
  await assert.rejects(
    () => analyzeHarmonyScreenshot({ data: Buffer.from("not-png"), mimeType: "image/png" }, vision),
    /valid PNG/,
  );
  await assert.rejects(
    () => analyzeHarmonyScreenshot({ data: png(8_000, 8_000), mimeType: "image/png" }, vision),
    /pixel limit/,
  );
  await assert.rejects(
    () => analyzeHarmonyScreenshot({ data: png(1080, 2400, 12 * 1024 * 1024 + 1), mimeType: "image/png" }, vision),
    /no larger than/,
  );
});
