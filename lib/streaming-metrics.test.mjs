import assert from "node:assert/strict";
import test from "node:test";
import { StreamingMetricsTracker } from "./streaming-metrics.ts";

function stream() {
  const tracker = new StreamingMetricsTracker();
  const message = { role: "assistant", content: [{ type: "text", text: "" }] };
  tracker.update({ type: "message_start", message }, 0);
  const append = (at, count = 40) => {
    const delta = "x".repeat(count);
    message.content[0].text += delta;
    tracker.update({ type: "message_update", message, assistantMessageEvent: { type: "text_delta", delta } }, at);
  };
  return { tracker, message, append };
}

test("background sampling restores the same recent rate after repeated view switches", () => {
  const { tracker, message, append } = stream();
  // Thirty seconds of generation without any frontend subscription or read.
  for (let at = 100; at <= 30_000; at += 100) append(at);
  for (let i = 0; i < 5; i++) assert.equal(tracker.getMessage(30_000).streamingMetrics.tokensPerSecond, 100);
  assert.equal(tracker.getMessage(30_000).content[0].text, message.content[0].text);
  assert.equal(message.streamingMetrics, undefined, "the SDK object must not persist transient metrics");
  assert.equal(tracker.getMetrics(31_000).tokensPerSecond, 80);
  assert.equal(tracker.getMetrics(35_000).tokensPerSecond, 0, "silence expires all generated tokens");
});

test("the rate follows the last five seconds instead of the lifetime average", () => {
  const { tracker, append } = stream();
  for (let at = 100; at <= 20_000; at += 100) append(at, 4);
  for (let at = 20_100; at <= 25_000; at += 100) append(at, 40);
  assert.equal(tracker.getMetrics(25_000).tokensPerSecond, 100);
});

test("dense provider deltas retain a recent window instead of accumulating the entire response", () => {
  const { tracker, append } = stream();
  for (let at = 20; at <= 30_000; at += 20) append(at, 8);
  assert.ok(Math.abs(tracker.getMetrics(30_000).tokensPerSecond - 100) < 2);
  for (let at = 30_020; at <= 35_000; at += 20) append(at, 4);
  assert.ok(Math.abs(tracker.getMetrics(35_000).tokensPerSecond - 50) < 2);
});

test("first chunks, new assistant turns, cancellation and other sessions never inherit a rate", () => {
  const { tracker, message, append } = stream();
  append(10_000, 20_000);
  assert.equal(tracker.getMetrics(10_000).tokensPerSecond, null);
  append(11_000, 40);
  assert.equal(tracker.getMetrics(11_000).tokensPerSecond, 10, "first chunk has no known generation interval");
  const generation = tracker.getMetrics(11_000).generation;
  tracker.update({ type: "message_end", message }, 11_000);
  assert.equal(tracker.getMessage(11_000), null);
  const fresh = { role: "assistant", content: [] };
  tracker.update({ type: "message_start", message: fresh }, 12_000);
  assert.ok(tracker.getMetrics(12_000).generation > generation);
  assert.equal(tracker.getMetrics(12_000).tokensPerSecond, null);
  assert.equal(stream().tracker.getMetrics(12_000).tokensPerSecond, null);
  tracker.update({ type: "agent_end" }, 12_000);
  assert.equal(tracker.getMetrics(12_000), null);
});

test("thinking and tool argument deltas contribute without counting input images", () => {
  const tracker = new StreamingMetricsTracker();
  const message = { role: "assistant", content: [{ type: "thinking", thinking: "" }, { type: "image", data: "x".repeat(1_000) }] };
  tracker.update({ type: "message_start", message }, 0);
  for (let i = 1; i <= 10; i++) {
    const delta = "x".repeat(40);
    if (i <= 5) message.content[0].thinking += delta;
    else {
      if (i === 6) message.content.push({ type: "toolCall", arguments: { command: "" } });
      message.content[2].arguments.command += delta;
    }
    tracker.update({ type: "message_update", message, assistantMessageEvent: { type: i > 5 ? "toolcall_delta" : "thinking_delta", delta } }, i * 100);
  }
  assert.equal(tracker.getMetrics(1_000).tokensPerSecond, 100);
});
