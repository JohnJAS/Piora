import assert from "node:assert/strict";
import test from "node:test";

const {
  getAgentRuntimeProfile,
  parseAgentRuntimeProfile,
  resetAgentRuntimeProfileForTests,
} = await import("./agent-runtime-profile.ts");

test.afterEach(() => resetAgentRuntimeProfileForTests());

test("runtime profile defaults to normal and accepts only the two cold-start profiles", () => {
  assert.equal(parseAgentRuntimeProfile({}), "normal");
  assert.equal(parseAgentRuntimeProfile({ PIORA_RUNTIME_PROFILE: "" }), "normal");
  assert.equal(parseAgentRuntimeProfile({ PIORA_RUNTIME_PROFILE: "device-control" }), "device-control");
  assert.throws(
    () => parseAgentRuntimeProfile({ PIORA_RUNTIME_PROFILE: "DEVICE-CONTROL" }),
    (error) => error?.code === "INVALID_RUNTIME_PROFILE",
  );
});

test("a live process cannot change its runtime profile", () => {
  assert.equal(getAgentRuntimeProfile({ PIORA_RUNTIME_PROFILE: "normal" }), "normal");
  assert.throws(
    () => getAgentRuntimeProfile({ PIORA_RUNTIME_PROFILE: "device-control" }),
    (error) => error?.code === "RUNTIME_PROFILE_CHANGED",
  );
});
