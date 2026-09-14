import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { LiveDictation } = await createJiti(import.meta.url).import("./live-dictation.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));
const voice = seconds => new Float32Array(Math.round(seconds * 16000)).fill(0.08);
function fixture(language = "zh") {
  const requests = [], texts = [], errors = [];
  const decoder = new LiveDictation({ sampleRate: 16000, language,
    transcribe: samples => new Promise((resolve, reject) => requests.push({ length: samples.length, resolve, reject })),
    onText: text => texts.push(text), onError: error => errors.push(error),
  });
  return { decoder, requests, texts, errors };
}
test("updates before stop, replaces interim text, and flushes trailing speech under backpressure", async () => {
  const { decoder, requests, texts } = fixture();
  decoder.push(voice(1));
  assert.equal(requests.length, 1);
  decoder.push(voice(0.4));
  assert.equal(requests.length, 1, "one inference in flight");
  requests[0].resolve("今天"); await tick();
  assert.deepEqual(texts, ["今天"], "visible while microphone is still open");
  const done = decoder.finish(); await tick();
  assert.equal(requests[1].length, 22400);
  requests[1].resolve("今天天气很好。");
  assert.equal(await done, true);
  assert.deepEqual(texts, ["今天", "今天天气很好。"]);
});
test("pause during inference commits the completed utterance once, then appends the next", async () => {
  const { decoder, requests, texts } = fixture("en");
  decoder.push(voice(1)); decoder.push(new Float32Array(8000)); decoder.push(voice(1));
  requests[0].resolve("hello"); await tick();
  assert.equal(requests[1].length, 24000);
  requests[1].resolve("hello world"); await tick();
  requests[2].resolve("next sentence"); await tick();
  assert.equal(await decoder.finish(), true);
  assert.equal(texts.at(-1), "hello world next sentence");
  assert.equal(requests.length, 3, "stop does not decode unchanged audio again");
});
test("cancellation ignores late results and quiet audio never invokes inference", async () => {
  const first = fixture(); first.decoder.push(voice(1)); first.decoder.cancel();
  first.requests[0].resolve("stale"); await tick();
  assert.deepEqual(first.texts, []);
  const quiet = fixture(); quiet.decoder.push(new Float32Array(32000)); await tick();
  assert.equal(await quiet.decoder.finish(), false);
  assert.equal(quiet.requests.length, 0);
});
test("recognition errors are reported once and stop can settle", async () => {
  const { decoder, requests, errors } = fixture(); decoder.push(voice(1));
  requests[0].reject(new Error("offline runtime failed")); await tick();
  await assert.rejects(decoder.finish(), /offline runtime failed/);
  assert.equal(errors.length, 1);
});
