import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createHarmonyDeviceManager } = await jiti.import("./harmony/index.ts");
const {
  beginPromptRun,
  finishPromptRun,
  resetPromptRunRegistryForTests,
} = await jiti.import("./prompt-run-registry.ts");
const { default: registerHarmonyExtension } = await jiti.import("../extensions/piora-harmony.ts");

const capabilities = {
  uiTree: true,
  screenshot: true,
  tap: true,
  swipe: true,
  inputText: true,
  keys: true,
  launchApp: true,
};

function fakeBackend() {
  const calls = [];
  return {
    calls,
    backend: {
      kind: "fake",
      hdcPath: "C:\\fake\\hdc.exe",
      async listDevices() {
        calls.push(["listDevices"]);
        return [{ serial: "phone-1", state: "online", model: "Mate", capabilities }];
      },
      async snapshot() {
        calls.push(["snapshot"]);
        return {
          nodes: [{
            text: "Open",
            id: "open-button",
            clickable: true,
            enabled: true,
            visible: true,
            bounds: { left: 10, top: 20, right: 110, bottom: 60 },
          }],
          screenshot: { mimeType: "image/png", data: Buffer.from("png") },
        };
      },
      async tap(_serial, x, y) { calls.push(["tap", x, y]); },
      async swipe() { calls.push(["swipe"]); },
      async inputText(_serial, text) { calls.push(["inputText", text]); },
      async pressKey(_serial, key) { calls.push(["pressKey", key]); },
      async launchApp(_serial, bundleName) { calls.push(["launchApp", bundleName]); },
    },
  };
}

function loadTool() {
  let tool;
  registerHarmonyExtension({ registerTool(candidate) { tool = candidate; } });
  assert.ok(tool, "Harmony extension should register a tool");
  return tool;
}

function context(sessionId, approvals) {
  return {
    hasUI: true,
    sessionManager: { getSessionId: () => sessionId },
    ui: {
      async confirm() { approvals.count += 1; return true; },
    },
  };
}

test("real tool execution keeps leases opaque and releases them at final run idle", async (t) => {
  resetPromptRunRegistryForTests();
  const { backend, calls } = fakeBackend();
  const manager = createHarmonyDeviceManager({ backend, token: () => "opaque-lease-token" });
  globalThis.__pioraHarmonyDeviceManager = manager;
  t.after(async () => {
    globalThis.__pioraHarmonyDeviceManager = undefined;
    resetPromptRunRegistryForTests();
    await manager.dispose();
  });

  const tool = loadTool();
  const approvals = { count: 0 };
  const ctx = context("session-1", approvals);
  const signal = new AbortController().signal;
  const run = beginPromptRun("session-1");

  const list = await tool.execute("call-list", { action: "list_devices" }, signal, undefined, ctx);
  assert.match(list.content[0].text, /phone-1/);

  const acquired = await tool.execute("call-acquire", {
    action: "acquire_control",
    serial: "phone-1",
  }, signal, undefined, ctx);
  assert.equal(approvals.count, 1);
  assert.equal(manager.getState("phone-1").leases.length, 1);
  assert.doesNotMatch(JSON.stringify(acquired), /opaque-lease-token/);
  assert.deepEqual(acquired.details.identity, {
    sessionId: "session-1",
    runId: run.runId,
    toolCallId: "call-acquire",
  });

  const snapshot = await tool.execute("call-snapshot", {
    action: "snapshot",
    serial: "phone-1",
  }, signal, undefined, ctx);
  assert.equal(snapshot.content[1].type, "image");
  assert.match(snapshot.content[0].text, /\[g1-r1-n0\]/);

  await tool.execute("call-tap", {
    action: "tap_ref",
    serial: "phone-1",
    ref: "g1-r1-n0",
    generation: 1,
  }, signal, undefined, ctx);
  assert.deepEqual(calls.at(-1), ["tap", 60, 40]);

  const entered = await tool.execute("call-text", {
    action: "input_text",
    serial: "phone-1",
    text: "private-test-value",
  }, signal, undefined, ctx);
  assert.doesNotMatch(JSON.stringify(entered), /private-test-value/);
  assert.equal(entered.details.characterCount, 18);

  await finishPromptRun(run, "idle");
  assert.equal(manager.getState("phone-1").leases.length, 0);
  await assert.rejects(
    tool.execute("late-call", { action: "snapshot", serial: "phone-1" }, signal, undefined, ctx),
    /active prompt run/,
  );
});
