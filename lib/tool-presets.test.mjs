import assert from "node:assert/strict";
import test from "node:test";

const { resolveAgentToolsForRuntimeProfile } = await import("./tool-presets.ts");

test("normal mode preserves requested coding tools", () => {
  assert.deepEqual(resolveAgentToolsForRuntimeProfile("normal", ["read", "bash"]), ["read", "bash"]);
  assert.equal(resolveAgentToolsForRuntimeProfile("normal", undefined), undefined);
});

test("device-control clamps every enabled preset to Harmony and preserves explicit all-off", () => {
  assert.deepEqual(resolveAgentToolsForRuntimeProfile("device-control", undefined), ["harmony_device", "piora_goal"]);
  assert.deepEqual(resolveAgentToolsForRuntimeProfile("device-control", ["bash", "read"]), ["harmony_device", "piora_goal"]);
  assert.deepEqual(resolveAgentToolsForRuntimeProfile("device-control", []), []);
});
