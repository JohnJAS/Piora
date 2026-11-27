import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createJiti } from "jiti";

test("prediction follows the selected branch and isolates cancellation between callers", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "piora-predict-api-"));
  const state = { busy: false, calls: [], leaves: [], run: null };
  globalThis.__predictionFixture = state;
  try {
    const stub = path.join(directory, "stub.ts");
    await writeFile(stub, `
      const state = globalThis.__predictionFixture;
      export const SessionManager = { open: () => ({
        getLeafId: () => "a", getEntries: () => [{ id: "a" }, { id: "branch" }], getCwd: () => "/fixture",
      }) };
      export const buildSessionContext = (entries, leaf) => {
        state.leaves.push(leaf);
        return { messages: [
          { role: "user", content: "earlier goal on " + leaf },
          { role: "toolResult", content: [{ type: "text", text: "test result" }] },
          { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Finished" }] },
        ], entryIds: ["u", "t", "a"] };
      };
      export const resolveSessionPath = async () => "/fixture/session";
      export const getRpcSession = () => ({ isRunning: () => state.busy });
      export const createTrustedModelServices = async () => ({
        settingsManager: { getEnabledModels: () => undefined },
        modelRuntime: { completeSimple: async (model, input, options) => {
          state.calls.push({ model, input, options });
          return state.run
            ? state.run(options)
            : { stopReason: "stop", content: [{ type: "text", text: "Please continue." }] };
        } },
      });
      export const resolveVisibleModels = async () => ({ visible: [{ provider: "fixture", id: "small" }] });
    `);
    let source = await readFile("lib/input-prediction-server.ts", "utf8");
    for (const name of ["@earendil-works/pi-coding-agent", "./session-reader", "./rpc-manager", "./model-runtime-context", "./model-scope"]) {
      source = source.replaceAll(JSON.stringify(name), JSON.stringify(stub.replaceAll("\\", "/")));
    }
    for (const name of ["request-security", "bounded-json", "reply-suggestions", "input-prediction"]) {
      source = source.replaceAll(JSON.stringify("./" + name), JSON.stringify(path.resolve("lib/" + name + ".ts").replaceAll("\\", "/")));
    }
    const file = path.join(directory, "server.ts");
    await writeFile(file, source);
    const { handlePrediction } = await createJiti(import.meta.url).import(file);
    const request = (extra = {}, signal) => new Request("http://localhost:30141/api", {
      method: "POST",
      headers: { host: "localhost:30141", "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, model: { provider: "fixture", modelId: "small" }, timeoutMs: 5000, sourceEntryId: "a", ...extra }),
      signal,
    });

    assert.equal((await handlePrediction(request({ enabled: false }), "one")).status, 200);
    assert.equal(state.calls.length, 0);
    const response = await handlePrediction(request({ leafId: "branch" }), "one");
    assert.equal((await response.json()).text, "Please continue.");
    assert.equal(state.calls.length, 1);
    assert.match(state.calls[0].input.messages[0].content, /earlier goal on branch/);
    assert.match(state.calls[0].input.messages[0].content, /test result/);
    await handlePrediction(request({ leafId: "branch" }), "one");
    assert.equal(state.calls.length, 1, "completed results are cached");
    assert.equal((await handlePrediction(request({ leafId: "missing" }), "one")).status, 409);
    assert.equal((await handlePrediction(request({ model: { provider: "other", modelId: "unknown" } }), "one")).status, 422);
    state.busy = true;
    assert.equal((await handlePrediction(request(), "one")).status, 409);
    assert.equal(state.calls.length, 1);
    state.busy = false;

    let finish;
    const started = Promise.withResolvers();
    state.run = options => new Promise((resolve, reject) => {
      finish = () => resolve({ stopReason: "stop", content: [{ type: "text", text: "A shared result." }] });
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      started.resolve();
    });
    const controller = new AbortController();
    const first = handlePrediction(request({}, controller.signal), "shared");
    await started.promise;
    const second = handlePrediction(request(), "shared");
    await setImmediate();
    controller.abort();
    assert.equal((await first).status, 422);
    assert.equal(state.calls.at(-1).options.signal.aborted, false);
    finish();
    assert.equal((await (await second).json()).text, "A shared result.");
    assert.equal(state.calls.length, 2, "overlapping subscribers make one provider call");

    const cancelled = Promise.withResolvers();
    state.run = ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => { cancelled.resolve(); reject(signal.reason); }, { once: true });
    });
    const loneController = new AbortController();
    const alone = handlePrediction(request({}, loneController.signal), "cancelled");
    await setImmediate();
    loneController.abort();
    await cancelled.promise;
    assert.equal((await alone).status, 422);
    state.run = null;
    assert.equal((await (await handlePrediction(request(), "cancelled")).json()).text, "Please continue.");
    assert.equal(state.calls.length, 4, "cancelled requests leave the same source eligible for retry");
  } finally {
    delete globalThis.__predictionFixture;
    await rm(directory, { recursive: true, force: true });
  }
});
