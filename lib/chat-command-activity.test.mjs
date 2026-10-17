import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { ChatCommandActivityTracker } = await jiti.import("./chat-command-activity.ts");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("unawaited SDK work remains owned until it settles without a fixed grace delay", async () => {
  const tracker = new ChatCommandActivityTracker();
  const child = deferred();
  let finished = false;
  const execution = tracker.run("command-a", async () => { tracker.track(child.promise); return "handled"; }).then(result => { finished = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  child.resolve();
  assert.equal(await execution, "handled");
});

test("errors reported by an extension fail its own command even when the handler resolves", async () => {
  const tracker = new ChatCommandActivityTracker();
  await assert.rejects(tracker.run("command-a", async () => { tracker.fail(new Error("handler failed")); }), /handler failed/);
});

test("parallel command contexts do not exchange errors, phases or command identities", async () => {
  const tracker = new ChatCommandActivityTracker();
  const pending = deferred();
  const phases = [];
  const first = tracker.run("first", async () => { tracker.track(pending.promise); tracker.phase("waiting_input"); return tracker.commandId; }, { onPhase: phase => phases.push(phase) });
  const second = tracker.run("second", async () => { tracker.fail(new Error(tracker.commandId)); });
  await assert.rejects(second, /second/);
  assert.equal(tracker.commandId, undefined);
  pending.resolve();
  assert.equal(await first, "first");
  assert.deepEqual(phases, ["waiting_input"]);
});

test("settlement checks SDK idle again when deferred actions register another child", async () => {
  const tracker = new ChatCommandActivityTracker();
  let idleChecks = 0;
  await tracker.run("command-a", async () => {}, { waitForIdle: async () => { idleChecks++; if (idleChecks === 1) tracker.track(new Promise(resolve => setImmediate(resolve))); } });
  assert.equal(idleChecks, 2);
});
