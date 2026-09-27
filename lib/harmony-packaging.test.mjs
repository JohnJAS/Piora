import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";
import { createWebRuntimeArchive } from "../scripts/archive-web-runtime.mjs";
const jiti = createJiti(import.meta.url);
const { harmonyRuntimeAsset } = await jiti.import("./harmony/runtime/asset-path.ts");
const { workerEnvironment } = await jiti.import("./harmony/runtime/worker-client.ts");

test("Harmony executables and device resources survive ASAR as real sidecar files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harmony-runtime-archive-"));
  const previous = process.env.PIORA_WEB_RUNTIME_ROOT;
  try {
    const root = join(directory, "source"), archive = join(directory, "runtime.asar");
    const paths = [".harmony-worker/harmony/runtime/worker-entry.js", "lib/harmony/audio/acoustic-provider.ps1", "node_modules/hypium-driver/build/lib/resource/uitest_agent_v1.2.2.so", "node_modules/hypium-driver/package.json"];
    for (const path of paths) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), path); }
    await createWebRuntimeArchive(root, archive);
    process.env.PIORA_WEB_RUNTIME_ROOT = archive;
    for (const path of paths) assert.equal(await readFile(harmonyRuntimeAsset(...path.split("/")), "utf8"), path);
    const env = workerEnvironment("hdc", { PIORA_WEB_RUNTIME_ROOT: archive, NODE_PATH: "existing" });
    assert.deepEqual(env.NODE_PATH.split(delimiter), [join(`${archive}.unpacked`, "node_modules"), join(archive, "node_modules"), "existing"]);
  } finally { if (previous === undefined) delete process.env.PIORA_WEB_RUNTIME_ROOT; else process.env.PIORA_WEB_RUNTIME_ROOT = previous; await rm(directory, { recursive: true, force: true }); }
});
