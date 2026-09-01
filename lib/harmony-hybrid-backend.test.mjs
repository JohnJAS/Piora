import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { HybridHarmonyBackend, HarmonyError } = await jiti.import("./harmony/index.ts");

function hdcBackend(calls) {
  return {
    kind: "hdc-uitest",
    hdcPath: "C:\\fake\\hdc.exe",
    async listDevices() { return []; },
    async snapshot() { return {}; },
    async tap(_serial, x, y) { calls.push(["hdc-tap", x, y]); },
    async swipe() {},
    async inputText() {},
    async pressKey() {},
    async launchApp() {},
    async openVideoStream() { calls.push(["hdc-video"]); return { stream: "unchanged", async close() {} }; },
    dispose() {},
  };
}

function hypiumDriver(overrides = {}) {
  return {
    async tryRun() { return { used: false }; },
    async waitForIdle() { return false; },
    async semanticAction() { return { strategy: "hypium_semantic_rpc" }; },
    status() { return []; },
    async invalidate() {},
    async reset() {},
    ...overrides,
  };
}

test("the hybrid backend preserves the existing HDC video projection path byte-for-byte at the boundary", async () => {
  const calls = [];
  const backend = new HybridHarmonyBackend({ hdcBackend: hdcBackend(calls), hypiumDriver: hypiumDriver() });
  const connection = await backend.openVideoStream("phone-1");
  assert.equal(connection.stream, "unchanged");
  assert.deepEqual(calls, [["hdc-video"]]);
});

test("coordinate operations fall back to HDC only when Hypium was unavailable before mutation", async () => {
  const calls = [];
  const backend = new HybridHarmonyBackend({ hdcBackend: hdcBackend(calls), hypiumDriver: hypiumDriver() });
  await backend.tap("phone-1", 12, 34);
  assert.deepEqual(calls, [["hdc-tap", 12, 34]]);
});

test("a failed connected Hypium mutation is never replayed through HDC", async () => {
  const calls = [];
  const backend = new HybridHarmonyBackend({
    hdcBackend: hdcBackend(calls),
    hypiumDriver: hypiumDriver({ async tryRun() { throw new HarmonyError("AUTOMATION_DRIVER_FAILED", "rpc lost"); } }),
  });
  await assert.rejects(() => backend.tap("phone-1", 12, 34), (error) => error.code === "AUTOMATION_DRIVER_FAILED");
  assert.deepEqual(calls, []);
});
