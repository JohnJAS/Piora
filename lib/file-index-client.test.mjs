import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { getCachedFileIndex, loadFileIndex } = await jiti.import("./file-index-client.ts");

test("composers share both in-flight indexing and the parsed result for one cwd", async () => {
  const original = globalThis.fetch;
  const gate = Promise.withResolvers();
  const requests = [];
  globalThis.fetch = url => { requests.push(url); return gate.promise; };
  try {
    const first = loadFileIndex("/shared-project");
    assert.equal(loadFileIndex("/shared-project"), first);
    gate.resolve(Response.json({ files: ["src/index.ts", "README.md"] }));
    const index = await first;
    assert.equal(getCachedFileIndex("/shared-project"), index);
    assert.equal(await loadFileIndex("/shared-project"), index);
    assert.equal(requests.length, 1);
    assert.ok(index.entries.some(entry => entry.isDir && entry.path === "src"));
    assert.equal(getCachedFileIndex("/other-project"), null);
  } finally { globalThis.fetch = original; }
});

test("expired results remain readable during refresh, failures retry, and freshness starts after loading", async () => {
  const original = globalThis.fetch;
  const originalNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  try {
    globalThis.fetch = async () => { now += 20_000; return Response.json({ files: ["before.txt"] }); };
    const index = await loadFileIndex("/slow-project");
    globalThis.fetch = async () => { throw new Error("must still be fresh"); };
    assert.equal(await loadFileIndex("/slow-project"), index);
    now += 11_000;
    const gate = Promise.withResolvers();
    globalThis.fetch = () => gate.promise;
    const refreshing = loadFileIndex("/slow-project");
    assert.equal(getCachedFileIndex("/slow-project"), index);
    assert.equal(loadFileIndex("/slow-project"), refreshing);
    gate.resolve(new Response("unavailable", { status: 503 }));
    await assert.rejects(refreshing, /503/);
    assert.equal(getCachedFileIndex("/slow-project"), index);
    globalThis.fetch = async () => Response.json({ files: ["after.txt"], truncated: true });
    const updated = await loadFileIndex("/slow-project");
    assert.equal(updated.entries[0].path, "after.txt");
    assert.equal(updated.truncated, true);
  } finally { globalThis.fetch = original; Date.now = originalNow; }
});
