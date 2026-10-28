import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { shellRequest } = await createJiti(import.meta.url).import("./shell/client.ts");

test("connection timeout aborts a stalled request and its response body", async t => {
  for (const stage of ["headers", "body"]) {
    let signal;
    t.mock.method(globalThis, "fetch", async (_url, options) => {
      signal = options.signal;
      const stalled = () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      return stage === "headers" ? stalled() : { ok: true, json: stalled };
    });
    await assert.rejects(shellRequest("sessions", undefined, { timeoutMs: 10 }), /终端连接超时/);
    assert.equal(signal.aborted, true);
    t.mock.restoreAll();
  }
});

test("scope cancellation reaches fetch without changing the parent's signal", async t => {
  const parent = new AbortController();
  let child;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    child = options.signal;
    return new Promise((_resolve, reject) => child.addEventListener("abort", () => reject(child.reason), { once: true }));
  });
  const request = shellRequest("sessions", undefined, { signal: parent.signal, timeoutMs: 1000 });
  parent.abort(new Error("Workspace changed"));
  await assert.rejects(request, /Workspace changed/);
  assert.equal(child.aborted, true);
});

test("a durable command receipt is returned once without automatic resubmission", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ durable: true, accepted: true }));
  assert.deepEqual(await shellRequest("sessions/id/actions", { action: "submit" }), { durable: true, accepted: true });
});

test("ordinary terminal requests time out by default without retrying mutations", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const result = assert.rejects(shellRequest("sessions/id", undefined, { method: "DELETE" }), /终端连接超时/);
  t.mock.timers.tick(15_000);
  await result;
  assert.equal(calls, 1);
});

test("acknowledged terminal titles survive older metadata without consuming output sequence", async () => {
  const { preserveAcknowledgedShellTitle, applyShellEvent } = await createJiti(import.meta.url).import("./shell/client.ts");
  const saved = { title: "Saved name", generation: 2, sequence: 8 };
  const session = { id: "terminal", title: "Old name", generation: 2 };
  const current = { session, sequence: 4, output: "before", commands: [], runs: [] };
  const metadata = { type: "session", terminalId: "terminal", generation: 2, sequence: 5, session };
  const updated = applyShellEvent(current, preserveAcknowledgedShellTitle(metadata, saved));
  assert.equal(updated.session.title, saved.title);
  assert.equal(updated.sequence, 5, "metadata protection does not jump to the PATCH output cursor");
  const output = { type: "output", terminalId: "terminal", generation: 2, sequence: 6, commandId: null, data: "after" };
  assert.equal(preserveAcknowledgedShellTitle(output, saved), output);
  assert.equal(applyShellEvent(updated, output).output, "beforeafter");
  const snapshot = { type: "snapshot", terminalId: "terminal", generation: 2, sequence: 7, snapshot: { ...current, sequence: 7, output: "all output" } };
  const protectedSnapshot = preserveAcknowledgedShellTitle(snapshot, saved);
  assert.equal(protectedSnapshot.snapshot.session.title, saved.title);
  assert.equal(protectedSnapshot.snapshot.output, "all output");
  assert.equal(protectedSnapshot.sequence, 7);
  assert.equal(snapshot.snapshot.session.title, "Old name", "the transport frame remains immutable");
  for (const newer of [{ ...metadata, sequence: 8 }, { ...metadata, sequence: 9 }, { ...metadata, generation: 3, sequence: 1 }]) {
    assert.equal(preserveAcknowledgedShellTitle(newer, saved), newer, "newer metadata and restarted sessions remain authoritative");
  }
});

test("newer streamed titles win over delayed PATCH replies while newer output alone does not", async () => {
  const { acknowledgeShellTitle } = await createJiti(import.meta.url).import("./shell/client.ts");
  const metadata = (title, sequence) => ({ type: "session", terminalId: "terminal", generation: 1, sequence, session: { id: "terminal", title, generation: 1 } });
  const streamed = acknowledgeShellTitle(undefined, metadata("Renamed in another window", 20));
  assert.equal(acknowledgeShellTitle(streamed, metadata("Older PATCH reply", 10)), streamed);
  const output = { type: "output", terminalId: "terminal", generation: 1, sequence: 30, commandId: null, data: "new output" };
  assert.equal(acknowledgeShellTitle(streamed, output), streamed, "output cannot advance the title revision");
  assert.equal(acknowledgeShellTitle(acknowledgeShellTitle(streamed, output), metadata("Own acknowledged rename", 25)).title, "Own acknowledged rename");
  const restarted = { ...metadata("Restored title", 1), generation: 2 };
  assert.equal(acknowledgeShellTitle(streamed, restarted).title, "Restored title");
});
