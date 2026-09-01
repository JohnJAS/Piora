import assert from "node:assert/strict";
import test from "node:test";
const { createJiti } = await import("jiti");
const {
  DEFAULT_LIVE_OUTPUT_AUTO_SCROLL,
  LIVE_OUTPUT_AUTO_SCROLL_STORAGE_KEY,
  parseStoredLiveOutputAutoScroll,
  serializeLiveOutputAutoScroll,
} = await createJiti(import.meta.url).import("./live-output-auto-scroll.ts");

test("live output auto-scroll defaults on and preserves explicit choices", () => {
  assert.equal(DEFAULT_LIVE_OUTPUT_AUTO_SCROLL, true);
  assert.equal(LIVE_OUTPUT_AUTO_SCROLL_STORAGE_KEY, "piora-live-output-auto-scroll:v1");
  assert.equal(parseStoredLiveOutputAutoScroll(null), true);
  assert.equal(parseStoredLiveOutputAutoScroll("invalid"), true);
  assert.equal(parseStoredLiveOutputAutoScroll("true"), true);
  assert.equal(parseStoredLiveOutputAutoScroll("false"), false);
  assert.equal(serializeLiveOutputAutoScroll(true), "true");
  assert.equal(serializeLiveOutputAutoScroll(false), "false");
});
