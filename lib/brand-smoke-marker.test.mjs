import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { validateBrandSmokeMarker } from "../scripts/smoke-test-portable.mjs";

function marker(id) {
  const custom = id === "xiaoyi-harness";
  const displayName = custom ? "XiaoYiHarness" : "Piora";
  return {
    brand: { id, artifactPrefix: displayName, displayName,
      updateChannels: { stable: custom ? "xiaoyi-latest" : "latest", preview: custom ? "xiaoyi-beta" : "beta" } },
    windowTitle: `Workspace - ${displayName}`,
    runtimePaths: { userData: resolve("fixture/profile"), sessionData: resolve("fixture/profile"), agentDirectory: resolve("fixture/agent"), partition: "persist:piora" },
  };
}
const paths = { userData: resolve("fixture/profile") };
const agent = resolve("fixture/agent");

test("brand smoke contract accepts matching compiled identity and actual data paths", () => {
  for (const id of ["piora", "xiaoyi-harness"]) validateBrandSmokeMarker(marker(id), id, paths, agent);
});

test("brand smoke contract rejects cross-brand channels, titles and divergent data roots", () => {
  for (const mutate of [
    m => { m.brand.id = "piora"; },
    m => { m.brand.artifactPrefix = "Piora"; },
    m => { m.brand.updateChannels.stable = "latest"; },
    m => { m.brand.updateChannels.preview = "beta"; },
    m => { m.windowTitle = "Piora"; },
    m => { m.runtimePaths.userData = resolve("other/profile"); },
    m => { m.runtimePaths.sessionData = resolve("other/profile"); },
    m => { m.runtimePaths.agentDirectory = resolve("other/agent"); },
    m => { m.runtimePaths.partition = "persist:xiaoyi"; },
  ]) {
    const value = marker("xiaoyi-harness");
    mutate(value);
    assert.throws(() => validateBrandSmokeMarker(value, "xiaoyi-harness", paths, agent));
  }
});
