import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createJiti } from "jiti";
import { Input, BufferSource, MP4, EncodedPacketSink } from "mediabunny";
const { startOwnedRecording } = await createJiti(import.meta.url).import("./harmony/media/owned-recording.ts");
function packet(type, data) { const header = Buffer.alloc(8); header.writeUInt32BE(type); header.writeUInt32BE(data.length, 4); return Buffer.concat([header, data]); }
test("owned recording muxes actual encoded frames, finalizes MP4, and closes only its connection", { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "piora-recorder-test-"));
  const browser = process.platform === "win32" ? await chromium.launch({ channel: "msedge", headless: true }) : undefined;
  let input;
  try {
    let encoded;
    if (browser) {
    const page = await browser.newPage();
    await page.route("https://recording.test/", route => route.fulfill({ contentType: "text/html", body: "<canvas width=64 height=64></canvas>" }));
    await page.goto("https://recording.test/");
    encoded = await page.evaluate(async () => {
      const chunks = [], configs = [];
      const encoder = new VideoEncoder({ output(chunk, meta) { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); chunks.push({ data: [...data], type: chunk.type, timestamp: chunk.timestamp }); if (meta?.decoderConfig?.description) configs.push([...new Uint8Array(meta.decoderConfig.description)]); }, error(error) { throw error; } });
      encoder.configure({ codec: "avc1.42001f", width: 64, height: 64, bitrate: 100000, framerate: 30, avc: { format: "avc" }, hardwareAcceleration: "prefer-software" });
      const canvas = document.querySelector("canvas"); canvas.getContext("2d").fillRect(0, 0, 64, 64);
      for (let i = 0; i < 3; i++) { const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1000000 / 30), duration: Math.round(1000000 / 30) }); encoder.encode(frame, { keyFrame: i === 0 }); frame.close(); }
      await encoder.flush(); encoder.close(); return { chunks, config: configs[0] };
    });
    } else encoded = JSON.parse(await readFile(new URL("../tests/harmony-media/h264-64x64.json", import.meta.url), "utf8"));
    if (process.env.PIORA_UPDATE_H264_FIXTURE === "1") {
      await mkdir(new URL("../tests/harmony-media/", import.meta.url), { recursive: true });
      await writeFile(new URL("../tests/harmony-media/h264-64x64.json", import.meta.url), JSON.stringify(encoded));
    }
    const avcc = Buffer.from(encoded.config), sl = avcc.readUInt16BE(6), sps = avcc.subarray(8, 8 + sl), pl = avcc.readUInt16BE(9 + sl), pps = avcc.subarray(11 + sl, 11 + sl + pl);
    const config = Buffer.alloc(17 + sl + pl); config.writeUInt32BE(64, 1); config.writeUInt32BE(64, 5); config.writeUInt32BE(30, 9); config.writeUInt16BE(sl, 13); sps.copy(config, 15); config.writeUInt16BE(pl, 15 + sl); pps.copy(config, 17 + sl);
    const packets = [packet(2, config)];
    for (const chunk of encoded.chunks) {
      const raw = Buffer.from(chunk.data), units = [];
      for (let offset = 0; offset < raw.length;) { const size = raw.readUInt32BE(offset); units.push(Buffer.from([0,0,0,1]), raw.subarray(offset + 4, offset + 4 + size)); offset += 4 + size; }
      const header = Buffer.alloc(9); header[0] = chunk.type === "key" ? 1 : 0; header.writeBigUInt64BE(BigInt(chunk.timestamp), 1);
      packets.push(packet(3, Buffer.concat([header, ...units])));
    }
    let closes = 0, streamController;
    const connection = { stream: new ReadableStream({ start(controller) { streamController = controller; }, cancel() {} }), async close() { closes++; } };
    const pending = startOwnedRecording(connection);
    for (const value of packets) { streamController.enqueue(value.subarray(0, 7)); streamController.enqueue(value.subarray(7)); }
    const recording = await pending;
    // Let the pump consume the queued frames before the requested stop.
    await new Promise(resolve => setImmediate(resolve));
    const destination = join(directory, "result.mp4");
    assert.ok(await recording.stop(destination) > 100);
    assert.equal(closes, 1);
    assert.equal(await recording.stop(destination), (await readFile(destination)).length);
    input = new Input({ source: new BufferSource(await readFile(destination)), formats: [MP4] });
    const track = await input.getPrimaryVideoTrack();
    assert.equal(track.displayWidth, 64); assert.equal(track.displayHeight, 64);
    const first = await new EncodedPacketSink(track).getFirstPacket(); assert.equal(first.type, "key"); assert.ok(first.byteLength > 0);
    assert.ok(await input.computeDuration() > 0);
  } finally { input?.dispose(); await browser?.close(); await rm(directory, { recursive: true, force: true }); }
});
test("cancelling recording startup reclaims its own reader without a device write", async () => {
  const controller = new AbortController(); let closed = 0;
  const pending = startOwnedRecording({ stream: new ReadableStream(), async close() { closed++; } }, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error.code === "COMMAND_ABORTED");
  assert.equal(closed, 1);
});
