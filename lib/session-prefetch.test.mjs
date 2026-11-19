import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("./session-prefetch.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(respond) {
  const requests = [];
  const context = { exports: {}, Blob, AbortController, AbortSignal, window: { setTimeout() {} },
    fetch: async (url, options) => { requests.push({ url, options }); return respond(url, options); } };
  vm.runInNewContext(compiled, context);
  return { ...context.exports, requests };
}

test("a completed history can seed the first render using the sidebar or response version", async () => {
  let releaseHistory;
  const h = harness(() => new Promise(resolve => { releaseHistory = resolve; }));
  const session = { id: "cold", modified: "sidebar-version" };
  h.prefetchSession(session);
  const loading = h.takePrefetchedSession(session);
  assert.equal(h.requests.length, 1, "click shares the in-flight hover request");
  assert.equal(h.peekPrefetchedSession(session), null);
  releaseHistory(Response.json({ context: { messages: [{ role: "user", content: "latest" }] }, info: { modified: "fresh-version" } }));
  const snapshot = await loading;
  h.cancelPendingSessionPrefetch(session.id);
  assert.equal(h.peekPrefetchedSession(session), snapshot);
  assert.equal(h.peekPrefetchedSession({ ...session, modified: "fresh-version" }), snapshot);
  assert.equal(h.peekPrefetchedSession({ ...session, modified: "newer-version" }), null);
});

test("leaving a loading chat aborts its pending history and ignores the late response", async () => {
  let releaseHistory;
  const h = harness(() => new Promise(resolve => { releaseHistory = resolve; }));
  const session = { id: "leaving", modified: "one" };
  const first = h.takePrefetchedSession(session);
  h.cancelPendingSessionPrefetch(session.id);
  assert.equal(h.requests[0].options.signal.aborted, true);
  releaseHistory(Response.json({ sessionId: session.id, context: { messages: [] } }));
  assert.equal(await first, null);
  assert.equal(h.peekPrefetchedSession(session), null);
});

test("a failed history or a response for a different chat never becomes a usable snapshot", async () => {
  const session = { id: "offline", modified: "one" };
  for (const response of [
    new Response("offline", { status: 503 }),
    Response.json({ info: { id: "unrelated" }, context: { messages: [] } }),
    Response.json({ sessionId: "unrelated", context: { messages: [] } }),
  ]) {
    const h = harness(() => response);
    assert.equal(await h.takePrefetchedSession(session), null);
    assert.equal(h.peekPrefetchedSession(session), null);
  }
});
