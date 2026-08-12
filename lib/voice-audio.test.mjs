import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  encodePcm16Wav,
  mergeAudioChunks,
  resampleAudio,
} = await jiti.import("./voice-audio.ts");
const { validateWhisperWav } = await jiti.import("./whisper-transcription.ts");

test("combines, resamples, and encodes browser audio for Whisper", () => {
  const merged = mergeAudioChunks([
    new Float32Array([0, 0.5]),
    new Float32Array([-0.5, 1]),
  ]);
  assert.deepEqual(Array.from(merged), [0, 0.5, -0.5, 1]);

  const resampled = resampleAudio(merged, 32_000, 16_000);
  assert.equal(resampled.length, 2);
  const wav = encodePcm16Wav(resampled);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
  assert.equal(new DataView(wav.buffer).getUint32(24, true), 16_000);
  assert.doesNotThrow(() => validateWhisperWav(wav));
});

test("rejects audio that does not match the bundled Whisper input format", () => {
  const wav = encodePcm16Wav(new Float32Array([0]), 8_000);
  assert.throws(() => validateWhisperWav(wav), /16 kHz mono PCM16 WAV/);
});
