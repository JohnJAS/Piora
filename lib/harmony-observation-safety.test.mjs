import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { controlledBackend } from "./harmony/fixtures/controlled-backend.mjs";

const jiti = createJiti(import.meta.url);
const { createHarmonyDeviceManager, runHarmonyScenario } = await jiti.import("./harmony/index.ts");

for (const fault of ["empty", "missing", "partial", "duplicate", "changed-label", "identity-lost", "expired"]) {
  test(`semantic refs never dispatch a tap after ${fault} observation`, async () => {
    const { backend, state, calls } = controlledBackend();
    let now = Date.now();
    const manager = createHarmonyDeviceManager({ backend, now: () => now });
    try {
      const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run" } });
      const snapshot = await manager.snapshot({ serial: "phone-1" });
      const node = state.observation.nodes[0];
      if (fault === "empty") state.observation = { tree: {}, nodes: [] };
      if (fault === "missing") state.observation = {};
      if (fault === "partial") state.observation.quality = { treeStatus: "partial", scopeComplete: false };
      if (fault === "duplicate") state.observation.nodes = [node, { ...node }];
      if (fault === "changed-label") state.observation.nodes = [{ ...node, text: "Delete" }];
      if (fault === "identity-lost") state.observation.nodes = [{ ...node, text: undefined, id: undefined }];
      if (fault === "expired") now += 31_000;
      await assert.rejects(manager.tapRef({ serial: "phone-1", leaseToken: lease.token,
        ref: snapshot.nodes[0].ref, generation: snapshot.generation }),
      error => ["STALE_SNAPSHOT", "OBSERVATION_UNAVAILABLE"].includes(error.code));
      assert.equal(calls.filter(call => call.action === "tap").length, 0);
    } finally { await manager.dispose(); }
  });
}

for (const observation of [
  {},
  { nodes: [] },
  { nodes: [], quality: { treeStatus: "partial", scopeComplete: false } },
  { nodes: [], quality: { treeStatus: "parse-error", scopeComplete: false } },
]) {
  test(`missing target is not proof of disappearance: ${JSON.stringify(observation)}`, async () => {
    const result = await runHarmonyScenario({ serial: "phone-1", leaseToken: "fixture",
      steps: [{ action: "assert", condition: { selector: { id: "target" }, exists: false } }] }, {
      serial: "phone-1", generation: 1, backend: { kind: "fixture" }, signal: new AbortController().signal,
      capture: async () => ({ serial: "phone-1", generation: 1, revision: 1, capturedAt: new Date().toISOString(), ...observation }),
      invalidateSnapshot() {},
    });
    assert.equal(result.status, "failed");
    assert.match(result.steps[0].message, /OBSERVATION_UNAVAILABLE/);
  });
}

test("a complete valid empty observation can prove absence", async () => {
  const result = await runHarmonyScenario({ serial: "phone-1", leaseToken: "fixture",
    steps: [{ action: "assert", condition: { selector: { id: "target" }, exists: false } }] }, {
    serial: "phone-1", generation: 1, backend: { kind: "fixture" }, signal: new AbortController().signal,
    capture: async () => ({ serial: "phone-1", generation: 1, revision: 1, capturedAt: new Date().toISOString(),
      nodes: [], quality: { treeStatus: "valid", scopeComplete: true, scope: "active-windows" } }),
    invalidateSnapshot() {},
  });
  assert.equal(result.status, "passed");
});
