import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { ExtensionUiBridge } = await jiti.import("./extension-ui-bridge.ts");

function createBridge(overrides = {}) {
  const events = [];
  const phases = [];
  let alive = true;
  let stopping = false;
  let abortGeneration = 0;

  const bridge = new ExtensionUiBridge({
    isAlive: () => alive,
    isStopping: () => stopping,
    getAbortGeneration: () => abortGeneration,
    getInner: () => ({ agent: {}, navigateTree: async () => ({ cancelled: false }), reload: async () => {}, extensionRunner: {} }),
    getPermissionParentUi: () => undefined,
    getSubagentUiSignal: () => new AbortController().signal,
    getChatCommandActivity: () => ({
      commandId: "cmd_test",
      phase: (p) => phases.push(p),
      fail: () => {},
    }),
    emit: (event) => events.push(event),
    applyForcedEmptySystemPrompt: () => {},
    ...overrides,
  });

  return {
    bridge,
    events,
    phases,
    setAlive: (v) => { alive = v; },
    setStopping: (v) => { stopping = v; },
    bumpAbort: () => { abortGeneration += 1; },
  };
}

test("ExtensionUiBridge resolves confirm responses and releases tool approvals in bulk", async () => {
  const { bridge, events } = createBridge();
  const ui = bridge.createExtensionUiContext();

  const regularConfirm = ui.confirm("Normal", "Proceed?");
  const approval = bridge.requestExtensionUi(
    { method: "confirm", toolApproval: true, title: "bash", message: "Run ls" },
    "deny",
    (response) => ("confirmed" in response && response.confirmed ? "once" : "deny"),
  );

  assert.equal(bridge.hasPendingApproval(), true);
  assert.equal(bridge.getPendingUiRequests().length, 2);

  // Bulk release resolves only toolApproval prompts, leaving ordinary confirms open.
  bridge.releaseToolApprovals();
  assert.equal(await approval, "once");
  assert.equal(bridge.getPendingUiRequests().length, 1);

  const remaining = bridge.getPendingUiRequests()[0];
  bridge.resolveExtensionUiResponse({ type: "extension_ui_response", id: remaining.id, confirmed: true });
  assert.equal(await regularConfirm, true);
  assert.equal(bridge.hasPendingApproval(), false);
  assert.ok(events.some((e) => e.method === "close" && e.reason === "answered"));
});

test("ExtensionUiBridge cancels pending requests via AbortSignal and destroy", async () => {
  const { bridge } = createBridge();
  const ui = bridge.createExtensionUiContext();
  const controller = new AbortController();

  const abortedPrompt = ui.input("Name?", undefined, { signal: controller.signal });
  controller.abort();
  assert.equal(await abortedPrompt, undefined);

  const pendingOnDestroy = ui.select("Pick", ["a", "b"]);
  bridge.cancelAllForDestroy();
  assert.equal(await pendingOnDestroy, undefined);
  assert.equal(bridge.hasPendingApproval(), false);
});

test("ExtensionUiBridge renders custom headless TUI, forwards input, and disposes on done", async () => {
  const { bridge, events } = createBridge();
  const ui = bridge.createExtensionUiContext();
  let disposed = false;

  const resultPromise = ui.custom((_tui, _theme, _kb, done) => {
    let text = "initial";
    return {
      render: () => [text],
      handleInput: (data) => {
        text = `got:${data}`;
        if (data === "enter") done("selected");
      },
      dispose: () => { disposed = true; },
    };
  });

  await new Promise((resolve) => setImmediate(resolve));
  const pending = bridge.getPendingUiRequests();
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].lines, ["initial"]);

  bridge.handleExtensionUiInput(pending[0].id, "x");
  assert.deepEqual(bridge.getPendingUiRequests()[0].lines, ["got:x"]);

  bridge.handleExtensionUiInput(pending[0].id, "enter");
  assert.equal(await resultPromise, "selected");
  assert.equal(disposed, true);
  assert.equal(bridge.hasPendingApproval(), false);
  assert.ok(events.some((e) => e.method === "custom" && e.closed === true));
});
