import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useHarmonyLiveFrame.ts", import.meta.url), "utf8");

test("turns fatal decoder errors into a stream reconnect", () => {
  const decoderSource = source.slice(
    source.indexOf("    const configureDecoder"),
    source.indexOf("    const drawJpeg"),
  );

  assert.match(decoderSource, /attempt\.failure = failure/);
  assert.match(decoderSource, /attempt\.reader\?\.cancel\(failure\)/);
  assert.doesNotMatch(decoderSource, /setStatus\("error"\)/);
});

test("isolates JPEG work and readers to one connection attempt", () => {
  const connectSource = source.slice(
    source.indexOf("    const connect = async"),
    source.indexOf("    void connect\(\)"),
  );
  const consumeSource = source.slice(
    source.indexOf("    const consume = async"),
    source.indexOf("    const connect = async"),
  );

  assert.match(connectSource, /jpegChain: Promise\.resolve\(\)/);
  assert.match(connectSource, /await attempt\.jpegChain\.catch/);
  assert.match(consumeSource, /finally \{[\s\S]*await reader\.cancel\(\)[\s\S]*reader\.releaseLock\(\)/);
  assert.doesNotMatch(source, /let jpegChain = Promise\.resolve\(\)/);
});

test("backs off flapping streams until a connection is genuinely stable", () => {
  assert.match(source, /STABLE_STREAM_FRAMES = 30/);
  assert.match(source, /STABLE_STREAM_MS = 5_000/);
  assert.match(source, /attempt\.decodedFrames >= STABLE_STREAM_FRAMES/);
  assert.match(source, /failures > 1/);
  assert.match(source, /reconnectDelay\(failures\)/);
});

test("drops an overloaded H264 GOP until the next keyframe", () => {
  assert.match(source, /decoder\.decodeQueueSize > 8[\s\S]*firstKeyframe = false/);
});

test("falls back to interruptible screenshot observation when video is unavailable", () => {
  assert.match(source, /const pollFrames = async/);
  assert.match(source, /\/api\/harmony\/frame\?serial=/);
  assert.match(source, /setMode\("frames"\)/);
  assert.match(source, /\(!hasFrame && failures >= 1\) \|\| failures >= 3/);
  assert.match(source, /Keep the last frame visible and retry/);
});
