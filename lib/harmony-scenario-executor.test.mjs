import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { runHarmonyScenario, HarmonyError } = await jiti.import("./harmony/index.ts");

function snapshot(nodes) {
  return { serial: "phone-1", generation: 1, revision: 1, capturedAt: new Date().toISOString(), nodes };
}

test("a multi-step semantic scenario uses one compact RPC path and redacts input text from results", async () => {
  const calls = [];
  const backend = {
    kind: "fake",
    async semanticAction(_serial, request) { calls.push(["semantic", request.action, request.selector.id]); return { strategy: "hypium_semantic_rpc" }; },
    async waitForIdle() { calls.push(["idle"]); },
  };
  const result = await runHarmonyScenario({
    serial: "phone-1",
    leaseToken: "lease",
    steps: [
      { id: "open", action: "tap", selector: { id: "open" } },
      { id: "type", action: "input_text", selector: { id: "query" }, text: "private-search-text" },
      { id: "check", action: "assert", condition: { selector: { id: "done" } } },
    ],
  }, {
    serial: "phone-1",
    generation: 1,
    backend,
    signal: new AbortController().signal,
    capture: async () => snapshot([{ ref: "done", id: "done", visible: true }]),
    invalidateSnapshot() {},
  });
  assert.equal(result.status, "passed");
  assert.equal(result.completedSteps, 3);
  assert.deepEqual(calls.filter((call) => call[0] === "semantic").map((call) => call[1]), ["tap", "input_text"]);
  assert.equal(JSON.stringify(result).includes("private-search-text"), false);
});

test("semantic-driver unavailability falls back to a freshly resolved layout coordinate", async () => {
  const calls = [];
  const backend = {
    kind: "fake",
    async semanticAction() { throw new HarmonyError("AUTOMATION_DRIVER_UNAVAILABLE", "offline"); },
    async tap(_serial, x, y) { calls.push(["tap", x, y]); },
  };
  const result = await runHarmonyScenario({
    serial: "phone-1",
    leaseToken: "lease",
    steps: [{ action: "tap", selector: { text: "Open" } }],
    policy: { settleAfterAction: false },
  }, {
    serial: "phone-1",
    generation: 1,
    backend,
    signal: new AbortController().signal,
    capture: async () => snapshot([{ ref: "open", text: "Open", enabled: true, visible: true, bounds: { left: 10, top: 20, right: 110, bottom: 60 } }]),
    invalidateSnapshot() {},
  });
  assert.equal(result.status, "passed");
  assert.equal(result.steps[0].strategy, "layout_revalidated_coordinates");
  assert.deepEqual(calls, [["tap", 60, 40]]);
});

test("a failed assertion stops later mutations and returns a structured failure", async () => {
  let pressed = false;
  const result = await runHarmonyScenario({
    serial: "phone-1",
    leaseToken: "lease",
    steps: [
      { action: "assert", condition: { selector: { id: "required" } } },
      { action: "press_key", key: "home" },
    ],
  }, {
    serial: "phone-1",
    generation: 1,
    backend: { kind: "fake", async pressKey() { pressed = true; } },
    signal: new AbortController().signal,
    capture: async () => snapshot([]),
    invalidateSnapshot() {},
  });
  assert.equal(result.status, "failed");
  assert.equal(result.steps.length, 1);
  assert.match(result.steps[0].message, /SCENARIO_FAILED/);
  assert.equal(pressed, false);
});

test("caller cancellation aborts the active scenario instead of being reported as a normal failed test", async () => {
  const controller = new AbortController();
  const running = runHarmonyScenario({
    serial: "phone-1",
    leaseToken: "lease",
    steps: [{ action: "wait_idle", idleMs: 1_000, timeoutMs: 5_000 }],
  }, {
    serial: "phone-1",
    generation: 1,
    backend: {
      kind: "fake",
      async waitForIdle(_serial, _idle, _timeout, signal) {
        await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new HarmonyError("COMMAND_ABORTED", "aborted")), { once: true }));
      },
    },
    signal: controller.signal,
    capture: async () => snapshot([]),
    invalidateSnapshot() {},
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(running, (error) => error instanceof HarmonyError && error.code === "COMMAND_ABORTED");
});

test("scenario validation rejects malformed API payloads before any device mutation", async () => {
  let mutations = 0;
  const context = {
    serial: "phone-1",
    generation: 1,
    backend: { kind: "fake", async tap() { mutations += 1; } },
    signal: new AbortController().signal,
    capture: async () => snapshot([]),
    invalidateSnapshot() {},
  };
  await assert.rejects(
    () => runHarmonyScenario({
      serial: "phone-1",
      leaseToken: "lease",
      steps: [
        { action: "tap", selector: { id: "safe" } },
        { action: "install_app", hapPath: "relative/app.hap" },
      ],
    }, context),
    (error) => error instanceof HarmonyError && error.code === "INVALID_ARGUMENT",
  );
  await assert.rejects(
    () => runHarmonyScenario({
      serial: "phone-1",
      leaseToken: "lease",
      steps: [{ action: "tap", selector: { text: 42 } }],
    }, context),
    (error) => error instanceof HarmonyError && error.code === "INVALID_ARGUMENT",
  );
  await assert.rejects(
    () => runHarmonyScenario({
      serial: "phone-1",
      leaseToken: "lease",
      steps: [{ action: "tap", selector: { id: "safe" } }],
      policy: { captureFinalScreenshot: "yes" },
    }, context),
    (error) => error instanceof HarmonyError && error.code === "INVALID_ARGUMENT",
  );
  assert.equal(mutations, 0);
});
