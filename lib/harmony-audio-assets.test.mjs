import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const { AudioAssetStore, parsePcmWav } = await createJiti(import.meta.url).import("./harmony/audio/audio-assets.ts");
function wav(seconds=1) { const data = Buffer.alloc(44+32000*seconds); data.write("RIFF"); data.writeUInt32LE(data.length-8,4); data.write("WAVEfmt ",8); data.writeUInt32LE(16,16); data.writeUInt16LE(1,20); data.writeUInt16LE(1,22); data.writeUInt32LE(16000,24); data.writeUInt32LE(32000,28); data.writeUInt16LE(2,32); data.writeUInt16LE(16,34); data.write("data",36); data.writeUInt32LE(data.length-44,40); return data; }
test("audio imports validate PCM bytes and hash-pinned playback rejects replacement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "piora-audio-assets-"));
  try {
    const store = new AudioAssetStore(join(dir,"store")), path = join(dir,"fixture.wav"); writeFileSync(path,wav());
    const asset = await store.import(path); assert.equal(asset.durationMs,1000); assert.equal(asset.sampleRate,16000);
    const resolved = await store.resolve(asset.id); writeFileSync(resolved.path,wav(2));
    await assert.rejects(store.resolve(asset.id), error => error.code === "INVALID_ARGUMENT");
    await assert.rejects(store.resolve("../outside"));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("audio rejects disguised, truncated, too long and inconsistent sample layouts", () => {
  assert.throws(()=>parsePcmWav(Buffer.from("not WAV"))); assert.throws(()=>parsePcmWav(wav(31))); assert.throws(()=>parsePcmWav(wav().subarray(0,100)));
  const invalid=wav(); invalid.writeUInt32LE(48000,24); assert.throws(()=>parsePcmWav(invalid));
});
