import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createJiti } from "jiti";

// Opt-in real hardware gate. No implicit device selection or input approval.
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const serial = option("--serial");
const output = resolve(option("--output") ?? ".verification/harmony-device-report.json");
const report = { protocolVersion: 1, startedAt: new Date().toISOString(), status: "blocked", device: serial ? createHash("sha256").update(serial).digest("hex").slice(0, 12) : null, checks: [], scenarios: [], hardwareVerified: false };
let manager;
try {
  if (!serial || serial.startsWith("--")) throw new Error("An explicit --serial is required; no device was selected");
  const jiti = createJiti(import.meta.url);
  const { HarmonyDeviceManager } = await jiti.import("../lib/harmony/device-manager.ts");
  const { bindScenarioTemplate } = await jiti.import("../lib/harmony/scenario/templates.ts");
  manager = new HarmonyDeviceManager();
  const devices = await manager.listDevices();
  const device = devices.find(item => item.serial === serial && item.state === "online");
  if (!device) throw new Error("The selected device is not connected and authorized; hardware checks are not-run");
  report.matrix = { host: process.platform, node: process.version, appVersion: JSON.parse(await readFile("package.json", "utf8")).version, model: device.model, osVersion: device.osVersion, apiVersion: device.apiVersion };
  const doctor = await manager.doctor(serial);
  report.checks = doctor.checks;
  report.capabilities = doctor.capabilities;
  const snapshot = await manager.snapshot({ serial, includeTree: true, includeScreenshot: false });
  report.observation = { quality: snapshot.quality, nodeCount: snapshot.nodes?.length ?? 0 };
  if (snapshot.quality?.treeStatus !== "valid") throw new Error("An authorized, unlocked fixture window with a valid tree is required; unlock manually");
  const planPath = option("--plan");
  if (!planPath) throw new Error("Read-only diagnostics completed; an explicit --plan is required for hardware acceptance scenarios");
  if (process.env.PIORA_HARMONY_TEST_CONTROL !== "1") throw new Error("Set PIORA_HARMONY_TEST_CONTROL=1 only on the designated test runner to authorize ordinary fixture input");
  const raw = await readFile(resolve(planPath));
  if (raw.length > 128 * 1024) throw new Error("Hardware plan exceeds 128 KiB");
  const plan = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(plan.scenarios) || !plan.scenarios.length || plan.scenarios.length > 20) throw new Error("Plan requires 1–20 scenarios");
  const lease = await manager.acquireLease({ serial, owner: { kind: "manual", id: "hardware-verifier", sessionId: "hardware-verifier" } });
  report.planHash = createHash("sha256").update(raw).digest("hex");
  report.status = "running";
  for (const scenario of plan.scenarios) {
    if (typeof scenario.name !== "string" || scenario.name.length > 120) throw new Error("Every scenario needs a short name");
    const steps = scenario.template ? bindScenarioTemplate(scenario.template, scenario.parameters) : scenario.steps;
    const result = await manager.runScenario({ serial, leaseToken: lease.token, steps, policy: scenario.policy });
    report.scenarios.push({ name: scenario.name, status: result.status, steps: result.steps });
    if (result.status !== "passed") throw new Error(`Hardware scenario failed: ${scenario.name}`);
  }
  report.status = "passed";
  report.hardwareVerified = true;
} catch (error) {
  if (report.status === "running") report.status = "failed";
  report.reason = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (manager) {
    const result = await manager.dispose().catch(() => ({ cleanup: "uncertain" }));
    report.cleanup = result.cleanup;
    if (result.cleanup !== "complete") { report.status = "failed"; report.hardwareVerified = false; process.exitCode = 1; }
  }
  report.completedAt = new Date().toISOString();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, scenarios: report.scenarios.length, hardwareVerified: report.hardwareVerified, reason: report.reason, report: output }));
}
