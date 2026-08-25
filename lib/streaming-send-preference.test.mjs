import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  DEFAULT_STREAMING_SEND_PREFERENCE,
  normalizeStreamingSendPreference,
  parseStoredStreamingSendPreference,
  serializeStreamingSendPreference,
} = await jiti.import("./streaming-send-preference.ts");

test("keeps the current streaming choice flow by default", () => {
  assert.deepEqual(DEFAULT_STREAMING_SEND_PREFERENCE, {
    schemaVersion: 1,
    enabled: false,
    behavior: "steer",
  });
  assert.deepEqual(parseStoredStreamingSendPreference(null), DEFAULT_STREAMING_SEND_PREFERENCE);
});

test("normalizes malformed fields without enabling direct streaming sends", () => {
  assert.deepEqual(normalizeStreamingSendPreference({ enabled: "yes", behavior: "later" }), {
    schemaVersion: 1,
    enabled: false,
    behavior: "steer",
  });
  assert.deepEqual(parseStoredStreamingSendPreference("not-json"), DEFAULT_STREAMING_SEND_PREFERENCE);
});

test("round-trips enabled steer and queue preferences", () => {
  for (const behavior of ["steer", "followup"]) {
    const preference = { schemaVersion: 1, enabled: true, behavior };
    assert.deepEqual(
      parseStoredStreamingSendPreference(serializeStreamingSendPreference(preference)),
      preference,
    );
  }
});
