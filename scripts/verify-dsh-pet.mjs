// Opt-in network/native smoke: installs the pinned upstream package in a fresh
// temporary directory, starts its real desktop helper, and leaves evidence.
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";

const { DshPetManager } = await createJiti(import.meta.url).import("../desktop/src/dsh-pet-manager.ts");
const root = await mkdtemp(join(tmpdir(), "piora-dsh-pet-smoke-"));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--reuse-install")) throw new Error("Usage: verify-dsh-pet.mjs [--reuse-install VERIFIED_TEMP_ROOT]");
if (args[0] === "--reuse-install") {
  await cp(join(args[1], "installed"), join(root, "installed"), { recursive: true });
  if (existsSync(join(args[1], "home", "electron"))) await cp(join(args[1], "home", "electron"), join(root, "home", "electron"), { recursive: true });
}
console.log(JSON.stringify({ stage: args.length ? "reuse-installed-program" : "install", root }));
let tasks = [{ id: "smoke", runtime: "running", activity: { kind: "tool" }, taskRun: { phase: "running", attempt: 1 } }];
const manager = new DshPetManager({ root, tasks: async () => tasks, openSettings: async () => {}, openFolder: async () => {}, closeSettings: () => {} });
const report = { root, version: manager.status().version, runtime: process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.versions.node}`, checks: [], status: "running" };
async function wait(check, timeout = 1_500_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (manager.status().phase === "error") throw new Error(manager.status().error);
    if (await check()) return;
    await delay(500);
  }
  throw new Error("Smoke test timed out");
}
let runtime;
const progress = setInterval(() => {
  const status = manager.status();
  console.log(JSON.stringify({ phase: status.phase, progress: status.progress }));
}, 30_000);
try {
  if (args.length) {
    assert.equal(manager.status().installed, true);
    report.checks.push("reused verified installation (no fresh download)");
  } else {
    await manager.action("install");
    await wait(() => manager.status().installed);
    report.checks.push("verified upstream installation");
  }
  console.log(JSON.stringify({ stage: "start" }));
  await manager.action("start");
  await wait(() => manager.status().phase === "running", 60_000);
  runtime = JSON.parse(await readFile(join(root, "home", "dsh-pet", "standalone-runtime.json"), "utf8"));
  async function read(path) {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/dsh-pet-7340/${path}`, { headers: { "x-dsh-pet-token": runtime.token }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.ok, true, path);
    return response.json();
  }
  await wait(async () => (await read("state")).sections?.workStatus?.data?.state === "working");
  report.checks.push("real work status bridge");
  tasks = [{ id: "smoke", runtime: "idle", taskRun: { phase: "completed", attempt: 1 } }];
  await wait(async () => (await read("state")).sections?.workStatus?.data?.state === "success", 7000);
  report.checks.push("real completion state");
  console.log(JSON.stringify({ stage: "waiting-for-native-renderer" }));
  // Pose is reported by the real native renderer, not fabricated by the launcher.
  await wait(async () => {
    // Upstream extraction can briefly block the host event loop on first launch.
    let pose;
    try { pose = await read("pose?pet=main"); }
    catch (error) { if (error.name === "TimeoutError") return false; throw error; }
    if (pose?.ok !== true || !Number.isFinite(pose.x) || !Number.isFinite(pose.y) || !Number.isFinite(pose.updatedAt)) return false;
    report.pose = pose;
    return true;
  });
  report.checks.push("native renderer pose");
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = error.message; process.exitCode = 1;
} finally {
  clearInterval(progress);
  await manager.dispose();
  if (runtime) {
    try { process.kill(runtime.pid, 0); report.cleanup = "host still running"; report.status = "failed"; process.exitCode = 1; }
    catch { report.cleanup = "host exited"; }
  }
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
