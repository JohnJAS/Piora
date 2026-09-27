import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { controlledBackend } from "./harmony/fixtures/controlled-backend.mjs";
const { createHarmonyDeviceManager } = await createJiti(import.meta.url).import("./harmony/index.ts");

test("task application grants require approval, survive ordinary clicks and never cross app or lease", async () => {
  const { backend, calls, state } = controlledBackend();
  const manager = createHarmonyDeviceManager({ backend });
  try {
    const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run" } });
    const tap = () => manager.tap({ serial: lease.serial, leaseToken: lease.token, x: 20, y: 30 });
    await assert.rejects(tap(), error => error.code === "APPROVAL_REQUIRED");
    assert.equal(calls.some(call => call.action === "tap"), false);
    manager.resolveApproval(manager.listApprovals()[0].id, true);
    await tap(); await tap();
    state.observation.quality.appId = "com.other.app";
    await assert.rejects(tap(), error => error.code === "APPROVAL_REQUIRED");
    assert.equal(calls.filter(call => call.action === "tap").length, 2);
    manager.releaseLease(lease.token);
    const second = await manager.acquireLease({ serial: lease.serial, owner: { kind: "agent", id: "new-run" } });
    state.observation.quality.appId = "com.test.app";
    await assert.rejects(manager.tap({ serial: second.serial, leaseToken: second.token, x: 20, y: 30 }), error => error.code === "APPROVAL_REQUIRED");
  } finally { await manager.dispose(); }
});

for (const action of ["clear_app_data", "uninstall_app"]) {
  test(`${action} requires one-use authorization bound to the lease and exact target`, async () => {
    const { backend, calls } = controlledBackend();
    const manager = createHarmonyDeviceManager({ backend });
    try {
      const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run" } });
      const run = bundleName => manager.runScenario({ serial: lease.serial, leaseToken: lease.token,
        steps: [{ action, bundleName }], policy: { settleAfterAction: false } });
      assert.equal((await run("com.test.app")).status, "failed");
      assert.equal(calls.filter(call => call.action === action).length, 0);
      const [approval] = manager.listApprovals();
      manager.resolveApproval(approval.id, true);
      assert.equal((await run("com.other.app")).status, "failed");
      assert.equal((await run("com.test.app")).status, "passed");
      assert.equal((await run("com.test.app")).status, "failed");
      assert.equal(calls.filter(call => call.action === action).length, 1);
      manager.releaseLease(lease.token);
      assert.equal(manager.listApprovals().some(item => item.status === "approved"), false);
    } finally { await manager.dispose(); }
  });
}

test("HAP authorization rejects replaced source bytes before backend installation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "piora-hap-policy-"));
  const hapPath = join(directory, "app.hap");
  writeFileSync(hapPath, "first-build");
  const { backend, calls } = controlledBackend();
  const manager = createHarmonyDeviceManager({ backend, configPath: join(directory, "config.json") });
  try {
    const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run" } });
    const install = () => manager.installPackage({ serial: lease.serial, leaseToken: lease.token, hapPath });
    await assert.rejects(install(), error => error.code === "APPROVAL_REQUIRED");
    manager.resolveApproval(manager.listApprovals()[0].id, true);
    writeFileSync(hapPath, "second-build");
    await assert.rejects(install(), error => error.code === "APPROVAL_REQUIRED");
    assert.equal(calls.filter(call => call.action === "install_app").length, 0);
  } finally { await manager.dispose(); rmSync(directory, { recursive: true, force: true }); }
});
