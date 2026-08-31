import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  companionRuntimeStateFromBroadcast,
  fetchCompanionRuntimeState,
  saveCompanionRuntimeState,
} = await jiti.import("./companion-runtime-client.ts");

function runtimeState(overrides = {}) {
  return {
    version: 3,
    updatedAt: 1,
    migratedFromLocalStorage: false,
    settings: { quietHours: {} },
    todos: [],
    taskRecords: [],
    focusTimer: { durations: {} },
    library: [],
    memories: [],
    mind: { lastDecision: null, decisionHistory: [] },
    ...overrides,
  };
}

test("companion runtime broadcasts only accept versioned state messages", () => {
  const state = runtimeState({ updatedAt: 42 });
  assert.equal(companionRuntimeStateFromBroadcast({ type: "runtime-state", state }), state);
  assert.equal(companionRuntimeStateFromBroadcast({ type: "activity", state }), null);
  assert.equal(companionRuntimeStateFromBroadcast({ type: "runtime-state", state: { version: 2, updatedAt: 42 } }), null);
  assert.equal(companionRuntimeStateFromBroadcast({ type: "runtime-state", state: runtimeState({ mind: null }) }), null);
  assert.equal(companionRuntimeStateFromBroadcast({ type: "runtime-state", state: runtimeState({ todos: null }) }), null);
  assert.equal(companionRuntimeStateFromBroadcast({ type: "runtime-state", state: runtimeState({ updatedAt: Number.NaN }) }), null);
  assert.equal(companionRuntimeStateFromBroadcast(null), null);
});

test("companion state reads and writes use bounded requests", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const state = runtimeState({ updatedAt: 9 });
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(state), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  assert.deepEqual(await fetchCompanionRuntimeState({ timeoutMs: 100 }), state);
  assert.deepEqual(await saveCompanionRuntimeState(state, { timeoutMs: 100 }), state);
  assert.equal(calls[0].input, "/api/companion/state");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[1].init.body), { state });
  assert.ok(calls.every((call) => call.init.signal instanceof AbortSignal));
});

test("companion state requests time out instead of locking the UI forever", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });

  await assert.rejects(
    saveCompanionRuntimeState(runtimeState(), { timeoutMs: 5 }),
    /宠物状态请求超时/,
  );
});
