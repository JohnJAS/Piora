import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createHarmonyDeviceManager, HarmonyError } = await jiti.import("./harmony/index.ts");

const capabilities = {
  uiTree: true, screenshot: true, tap: true, swipe: true,
  inputText: true, keys: true, launchApp: true,
};

function fakeBackend(overrides = {}) {
  const calls = [];
  const backend = {
    kind: "fake",
    hdcPath: "C:\\fake\\hdc.exe",
    async listDevices() {
      calls.push(["listDevices"]);
      return [{ serial: "phone-1", state: "online", model: "Mate", capabilities }];
    },
    async snapshot() {
      calls.push(["snapshot"]);
      return {
        tree: { children: [] },
        nodes: [{ text: "Open", clickable: true, enabled: true, visible: true, bounds: { left: 10, top: 20, right: 110, bottom: 60 } }],
        screenshot: { mimeType: "image/png", data: Buffer.from("png") },
      };
    },
    async tap(_serial, x, y) { calls.push(["tap", x, y]); },
    async swipe(...args) { calls.push(["swipe", ...args.slice(1, 6)]); },
    async inputText(_serial, text) { calls.push(["inputText", text]); },
    async pressKey(_serial, key) { calls.push(["pressKey", key]); },
    async launchApp(_serial, bundle, ability) { calls.push(["launchApp", bundle, ability]); },
    ...overrides,
  };
  return { backend, calls };
}

test("enforces one expiring lease per physical device", async () => {
  let now = Date.parse("2026-08-12T00:00:00.000Z");
  const { backend } = fakeBackend();
  const manager = createHarmonyDeviceManager({ backend, now: () => now, token: () => "lease-a" });
  const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run-a" }, ttlMs: 5000 });
  assert.equal(lease.token, "lease-a");
  await assert.rejects(
    () => manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run-b" } }),
    (error) => error instanceof HarmonyError && error.code === "LEASE_CONFLICT",
  );
  now += 5001;
  assert.throws(() => manager.renewLease(lease.token),
    (error) => error instanceof HarmonyError && error.code === "LEASE_EXPIRED");
  await manager.dispose();
});

test("requires leases for writes and turns snapshot nodes into stale-safe refs", async () => {
  const { backend, calls } = fakeBackend();
  const manager = createHarmonyDeviceManager({ backend, token: () => "lease-a" });
  await assert.rejects(() => manager.tap({ serial: "phone-1", leaseToken: "", x: 1, y: 2 }),
    (error) => error instanceof HarmonyError && error.code === "LEASE_REQUIRED");
  const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run-a" } });
  const first = await manager.snapshot({ serial: "phone-1", leaseToken: lease.token });
  assert.match(first.nodes[0].ref, /^g1-r1-n0$/);
  await manager.tapRef({ serial: "phone-1", leaseToken: lease.token, ref: first.nodes[0].ref, generation: first.generation });
  assert.deepEqual(calls.at(-1), ["tap", 60, 40]);
  await manager.snapshot({ serial: "phone-1", leaseToken: lease.token });
  await assert.rejects(
    () => manager.tapRef({ serial: "phone-1", leaseToken: lease.token, ref: first.nodes[0].ref, generation: first.generation }),
    (error) => error instanceof HarmonyError && ["INVALID_ARGUMENT", "STALE_SNAPSHOT"].includes(error.code),
  );
  await manager.dispose();
});

test("live-view screenshot polling does not replace the latest UI-tree refs", async () => {
  const { backend, calls } = fakeBackend();
  const manager = createHarmonyDeviceManager({ backend, token: () => "lease-a" });
  const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run-a" } });
  const treeSnapshot = await manager.snapshot({ serial: "phone-1", leaseToken: lease.token });
  const frameSnapshot = await manager.snapshot({
    serial: "phone-1",
    includeTree: false,
    includeScreenshot: true,
  });
  assert.equal(frameSnapshot.nodes, undefined);
  assert.equal(frameSnapshot.revision, treeSnapshot.revision + 1);
  await manager.tapRef({
    serial: "phone-1",
    leaseToken: lease.token,
    ref: treeSnapshot.nodes[0].ref,
    generation: treeSnapshot.generation,
  });
  assert.deepEqual(calls.at(-1), ["tap", 60, 40]);
  await manager.dispose();
});

test("revalidates a UI ref against a fresh tree and invalidates refs after every write", async () => {
  let snapshotCount = 0;
  const { backend, calls } = fakeBackend({
    async snapshot() {
      snapshotCount += 1;
      return {
        tree: { children: [] },
        nodes: [{ text: snapshotCount === 1 ? "Delete" : "Cancel", clickable: true, enabled: true, visible: true, bounds: { left: 10, top: 20, right: 110, bottom: 60 } }],
        screenshot: { mimeType: "image/png", data: Buffer.from("png") },
      };
    },
  });
  const manager = createHarmonyDeviceManager({ backend, token: () => "lease-a" });
  const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run-a" } });
  const snapshot = await manager.snapshot({ serial: "phone-1", leaseToken: lease.token });
  await assert.rejects(
    () => manager.tapRef({ serial: "phone-1", leaseToken: lease.token, ref: snapshot.nodes[0].ref, generation: snapshot.generation }),
    (error) => error instanceof HarmonyError && error.code === "STALE_SNAPSHOT",
  );
  assert.equal(calls.some((call) => call[0] === "tap"), false);
  assert.equal(manager.getState().snapshots.length, 0);
  await manager.dispose();
});

test("releases a device lease as soon as the device becomes offline", async () => {
  let online = true;
  const { backend } = fakeBackend({
    async listDevices() {
      return [{ serial: "phone-1", state: online ? "online" : "offline", model: "Mate", capabilities }];
    },
  });
  const manager = createHarmonyDeviceManager({ backend, token: () => "lease-a" });
  await manager.acquireLease({ serial: "phone-1", owner: { kind: "manual", id: "manual:test" } });
  online = false;
  await manager.listDevices();
  assert.equal(manager.getState().leases.length, 0);
  await manager.dispose();
});

test("rejects an invalid HDC reconfiguration before changing the persisted or active runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "piora-harmony-manager-config-"));
  const configPath = join(directory, "harmony.json");
  const { backend, calls } = fakeBackend();
  let candidateDisposed = false;
  const manager = createHarmonyDeviceManager({
    configPath,
    backendFactory(config) {
      if (config.hdcPath) return {
        ...backend,
        async listDevices() { throw new HarmonyError("HDC_INVALID", "bad candidate"); },
        async dispose() { candidateDisposed = true; },
      };
      return backend;
    },
  });
  try {
    await assert.rejects(
      () => manager.updateConfig({ hdcPath: "C:\\bad\\hdc.exe" }),
      (error) => error instanceof HarmonyError && error.code === "HDC_INVALID",
    );
    assert.deepEqual(manager.getConfig(), {});
    assert.equal(existsSync(configPath), false);
    assert.equal(candidateDisposed, true);
    await manager.listDevices();
    assert.equal(calls.some((call) => call[0] === "listDevices"), true);
  } finally {
    await manager.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("globally serializes backend operations", async () => {
  let releaseTap;
  const started = [];
  const { backend } = fakeBackend({
    async tap() {
      started.push("tap");
      await new Promise((resolve) => { releaseTap = resolve; });
    },
    async pressKey() { started.push("key"); },
  });
  const manager = createHarmonyDeviceManager({ backend, token: () => "lease-a" });
  const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run-a" } });
  const tap = manager.tap({ serial: "phone-1", leaseToken: lease.token, x: 1, y: 2 });
  const key = manager.pressKey({ serial: "phone-1", leaseToken: lease.token, key: "back" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["tap"]);
  releaseTap();
  await Promise.all([tap, key]);
  assert.deepEqual(started, ["tap", "key"]);
  await manager.dispose();
});

test("emergency stop aborts active work, drops queued work, leases, and snapshots", async () => {
  let activeSignal;
  const { backend } = fakeBackend({
    async tap(_serial, _x, _y, signal) {
      activeSignal = signal;
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new HarmonyError("COMMAND_ABORTED", "aborted")), { once: true }));
    },
  });
  const manager = createHarmonyDeviceManager({ backend, token: () => "lease-a" });
  const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run-a" } });
  await manager.snapshot({ serial: "phone-1" });
  const active = manager.tap({ serial: "phone-1", leaseToken: lease.token, x: 1, y: 2 });
  const queued = manager.pressKey({ serial: "phone-1", leaseToken: lease.token, key: "home" });
  await new Promise((resolve) => setImmediate(resolve));
  await manager.emergencyStop();
  assert.equal(activeSignal.aborted, true);
  await assert.rejects(active, (error) => error.code === "COMMAND_ABORTED");
  await assert.rejects(queued, (error) => error.code === "COMMAND_ABORTED");
  assert.equal(manager.getState().leases.length, 0);
  assert.equal(manager.getState().snapshots.length, 0);
  await manager.dispose();
});

test("releaseOwner cancels that agent's active and queued device work", async () => {
  let activeSignal;
  const { backend } = fakeBackend({
    async tap(_serial, _x, _y, signal) {
      activeSignal = signal;
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new HarmonyError("COMMAND_ABORTED", "aborted")), { once: true }));
    },
  });
  const manager = createHarmonyDeviceManager({ backend, token: () => "lease-a" });
  const lease = await manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run-a" } });
  const active = manager.tap({ serial: "phone-1", leaseToken: lease.token, x: 1, y: 2 });
  const queued = manager.pressKey({ serial: "phone-1", leaseToken: lease.token, key: "home" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.releaseOwner("run-a"), 1);
  assert.equal(activeSignal.aborted, true);
  await assert.rejects(active, (error) => error.code === "COMMAND_ABORTED");
  await assert.rejects(queued, (error) => error.code === "LEASE_REQUIRED" || error.code === "COMMAND_ABORTED");
  await manager.dispose();
});

test("releaseOwner cancels a queued lease acquisition before it can create a lease", async () => {
  let unblockDiscovery;
  let calls = 0;
  const { backend } = fakeBackend({
    async listDevices() {
      calls += 1;
      if (calls === 1) await new Promise((resolve) => { unblockDiscovery = resolve; });
      return [{ serial: "phone-1", state: "online", model: "Mate", capabilities }];
    },
  });
  const manager = createHarmonyDeviceManager({ backend, token: () => "lease-a" });
  const blocker = manager.listDevices();
  const acquire = manager.acquireLease({ serial: "phone-1", owner: { kind: "agent", id: "run-a" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.releaseOwner("run-a"), 0);
  unblockDiscovery();
  await blocker;
  await assert.rejects(acquire, (error) => error.code === "COMMAND_ABORTED");
  assert.equal(manager.getState().leases.length, 0);
  await manager.dispose();
});
