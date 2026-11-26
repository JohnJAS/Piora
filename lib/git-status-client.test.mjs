import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { requestGitStatus } = await createJiti(import.meta.url).import("./git-status-client.ts");

test("cancelling one Git subscriber rejects promptly without cancelling other panels", async () => {
  const originalFetch = globalThis.fetch;
  let finish;
  let calls = 0;
  let sharedSignal;
  globalThis.fetch = async (_url, options) => {
    calls++;
    sharedSignal = options.signal;
    await new Promise((resolve) => { finish = resolve; });
    return Response.json({ isGitRepository: true, files: [], additions: 0, deletions: 0 });
  };
  try {
    const controller = new AbortController();
    const cancelled = requestGitStatus("/test/cancel", { signal: controller.signal });
    const retained = requestGitStatus("/test/cancel");
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await assert.rejects(cancelled, { name: "AbortError" });
    assert.equal(sharedSignal.aborted, false);
    assert.equal(calls, 1);
    finish();
    assert.equal((await retained).isGitRepository, true);
    assert.equal((await requestGitStatus("/test/cancel")).isGitRepository, true);
    assert.equal(calls, 1);
  } finally { finish?.(); globalThis.fetch = originalFetch; }
});

test("summary requests reuse warm or in-flight full files status, while files does not reuse summary", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const urls = [];
  globalThis.fetch = async (url) => {
    calls++;
    urls.push(String(url));
    return Response.json({
      isGitRepository: true,
      repositoryRoot: "/test/reuse",
      branch: "main",
      files: [{ filePath: "/test/reuse/a.ts", status: "modified", indexStatus: " ", worktreeStatus: "M", additions: 1, deletions: 0 }],
      additions: 1,
      deletions: 0,
    });
  };
  try {
    const full = await requestGitStatus("/test/reuse");
    const summary = await requestGitStatus("/test/reuse", { summary: true });
    assert.equal(calls, 1);
    assert.equal(summary.branch, full.branch);
    assert.equal(summary.files.length, 1);

    const summaryOnly = await requestGitStatus("/test/summary-first", { summary: true });
    assert.equal(calls, 2);
    assert.equal(summaryOnly.branch, "main");
    const fullAfterSummary = await requestGitStatus("/test/summary-first");
    assert.equal(calls, 3);
    assert.equal(fullAfterSummary.files.length, 1);
    assert.match(urls[0], /projection=files/);
    assert.match(urls[1], /projection=summary/);
    assert.match(urls[2], /projection=files/);
  } finally { globalThis.fetch = originalFetch; }
});
