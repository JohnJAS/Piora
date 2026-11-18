import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { DesktopExtensionRegistry } = await createJiti(import.meta.url).import("../desktop/src/desktop-extension-registry.ts");

function fixture(options = {}) {
  const calls = [];
  const state = { version: options.version ?? "1.0.0", installed: false, phase: "absent", autoStart: false, error: null, progress: null };
  return {
    calls,
    status: () => state,
    restore: () => { calls.push("restore"); },
    action: action => { calls.push(action); return state; },
    preferences: value => { calls.push(value); return { ...state, ...value }; },
    dispose: async () => { calls.push("dispose"); await options.dispose?.(); },
  };
}

test("the desktop catalog exposes both pinned adapters and delegates their own lifecycle", async () => {
  const registry = new DesktopExtensionRegistry();
  const pet = fixture({ version: "0.3.8" }), meme = fixture({ version: "0.1.76" });
  assert.deepEqual(registry.list().map(entry => entry.state), [null, null]);
  registry.register("dsh-pet", pet);
  registry.register("dsh-meme", meme);
  for (const { manifest, state } of registry.list()) {
    assert.equal(manifest.apiVersion, 1);
    assert.equal(manifest.compatibility, "dedicated-adapter");
    assert.equal(manifest.version, state.version);
    assert.equal(new URL(manifest.source).protocol, "https:");
    assert.match(manifest.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    registry.restore(manifest.id);
    for (const action of ["install", "cancel", "start", "settings", "stop", "uninstall"]) {
      assert.equal(await registry.action(manifest.id, action), state);
    }
  }
  registry.action("dsh-pet", "folder");
  assert.equal(registry.preferences("dsh-pet", { syncTasks: false }).syncTasks, false);
  assert.equal(registry.preferences("dsh-meme", { autoStart: true }).autoStart, true);
  assert.equal(registry.preferences("dsh-meme", {}).autoStart, false);
  assert.deepEqual(pet.calls, ["restore", "install", "cancel", "start", "settings", "stop", "uninstall", "folder", { syncTasks: false }]);
  assert.deepEqual(meme.calls, ["restore", "install", "cancel", "start", "settings", "stop", "uninstall", { autoStart: true }]);
});

test("pane input is limited to the registered extensions and supported capabilities", () => {
  const registry = new DesktopExtensionRegistry(), pet = fixture(), meme = fixture();
  registry.register("dsh-pet", pet);
  registry.register("dsh-meme", meme);
  assert.throws(() => registry.register("external", fixture()), /Unknown/);
  assert.throws(() => registry.register("dsh-pet", pet), /duplicate/);
  assert.throws(() => registry.action("unknown", "install"), /unavailable/);
  assert.throws(() => registry.action("dsh-meme", "folder"), /Unsupported/);
  assert.throws(() => registry.action("dsh-pet", "unknown"), /Unsupported/);
  assert.throws(() => registry.preferences("dsh-meme", { syncTasks: true }), /Unsupported/);
  assert.throws(() => registry.preferences("dsh-pet", { autoStart: "yes" }), /Unsupported/);
  assert.throws(() => registry.preferences("dsh-pet", { additional: true }), /Unsupported/);
  assert.throws(() => registry.preferences("dsh-pet", null), /Invalid/);
  assert.deepEqual([...pet.calls, ...meme.calls], [], "unsupported input must not reach the managers");
});

test("shutdown attempts both managers and retains only a failed cleanup for retry", async () => {
  const registry = new DesktopExtensionRegistry();
  let pending = true;
  const pet = fixture({ dispose: () => { if (pending) throw new Error("fixture failure"); } }), meme = fixture();
  registry.register("dsh-pet", pet);
  registry.register("dsh-meme", meme);
  const closing = registry.dispose();
  assert.equal(registry.dispose(), closing);
  assert.throws(() => registry.action("dsh-meme", "start"), /shutting down/);
  assert.deepEqual((await closing).map(result => result.status), ["fulfilled", "rejected"]);
  assert.deepEqual(registry.list().map(entry => entry.state), [pet.status(), null]);
  pending = false;
  assert.deepEqual((await registry.dispose()).map(result => result.status), ["fulfilled"]);
  assert.equal(registry.list().filter(entry => entry.state).length, 0);
  assert.deepEqual(pet.calls, ["dispose", "dispose"]);
  assert.deepEqual(meme.calls, ["dispose"]);
});
