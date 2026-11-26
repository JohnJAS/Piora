import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { fetchModelCatalog, clearModelCatalogCache } = await jiti.import("./model-catalog-client.ts");

test("the landing model catalog retries a transient empty startup response", async () => {
  const requestedUrls = [];
  const result = await fetchModelCatalog({
    retryDelaysMs: [0, 0],
    fetcher: async (url) => {
      requestedUrls.push(String(url));
      if (requestedUrls.length === 1) {
        return Response.json({ models: {}, modelList: [], modelError: "Model services are starting" });
      }
      return Response.json({
        models: { "provider:model": "Model" },
        modelList: [{ id: "model", name: "Model", provider: "provider" }],
      });
    },
  });

  assert.equal(result.modelList.length, 1);
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[0], "/api/models");
  assert.match(requestedUrls[1], /refresh=1/);
});

test("an empty startup response retries even when the server did not attach an error", async () => {
  let requestCount = 0;
  const result = await fetchModelCatalog({
    retryDelaysMs: [0, 0],
    fetcher: async () => {
      requestCount += 1;
      if (requestCount === 1) return Response.json({ models: {}, modelList: [] });
      return Response.json({
        models: { "provider:model": "Model" },
        modelList: [{ id: "model", name: "Model", provider: "provider" }],
      });
    },
  });

  assert.equal(result.modelList.length, 1);
  assert.equal(requestCount, 2);
});

test("a stalled startup request times out and retries with a refresh", async () => {
  const requestedUrls = [];
  const result = await fetchModelCatalog({
    retryDelaysMs: [0, 0],
    requestTimeoutMs: 5,
    fetcher: async (url, init) => {
      requestedUrls.push(String(url));
      if (requestedUrls.length > 1) {
        return Response.json({
          models: { "provider:model": "Model" },
          modelList: [{ id: "model", name: "Model", provider: "provider" }],
        });
      }
      return await new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    },
  });

  assert.equal(result.modelList.length, 1);
  assert.equal(requestedUrls.length, 2);
  assert.match(requestedUrls[1], /refresh=1/);
});

test("usable partial model results are returned without retrying", async () => {
  let requestCount = 0;
  const result = await fetchModelCatalog({
    retryDelaysMs: [0, 0, 0],
    fetcher: async () => {
      requestCount += 1;
      return Response.json({
        models: { "provider:model": "Model" },
        modelList: [{ id: "model", name: "Model", provider: "provider" }],
        modelError: "One extension provider is unavailable",
      });
    },
  });

  assert.equal(result.modelList.length, 1);
  assert.equal(requestCount, 1);
});

test("authorization failures do not enter the startup retry loop", async () => {
  let requestCount = 0;
  await assert.rejects(
    fetchModelCatalog({
      retryDelaysMs: [0, 0, 0],
      fetcher: async () => {
        requestCount += 1;
        return Response.json({ error: "Access denied" }, { status: 403 });
      },
    }),
    /Access denied/,
  );
  assert.equal(requestCount, 1);
});

test("model catalog cache reuses fresh results, deduplicates concurrent calls, and skips errors/forceRefresh", async () => {
  clearModelCatalogCache();
  let requests = 0;
  let resolveSlow;
  const fetcher = async (url) => {
    requests += 1;
    if (String(url).includes("cwd=slow")) {
      return await new Promise((resolve) => {
        resolveSlow = () => resolve(Response.json({
          models: { "p:m": "Slow" },
          modelList: [{ id: "m", name: "Slow", provider: "p" }],
        }));
      });
    }
    if (String(url).includes("cwd=err")) {
      return Response.json({
        models: { "p:m": "Partial" },
        modelList: [{ id: "m", name: "Partial", provider: "p" }],
        modelError: "transient",
      });
    }
    return Response.json({
      models: { "p:m": `Model-${requests}` },
      modelList: [{ id: "m", name: `Model-${requests}`, provider: "p" }],
    });
  };

  // Hit cache on 2nd call, bypass on forceRefresh.
  const first = await fetchModelCatalog({ cwd: "proj-a", useCache: true, fetcher });
  const second = await fetchModelCatalog({ cwd: "proj-a", useCache: true, fetcher });
  assert.equal(requests, 1);
  assert.deepEqual(second, first);

  const refreshed = await fetchModelCatalog({ cwd: "proj-a", forceRefresh: true, useCache: true, fetcher });
  assert.equal(requests, 2);
  assert.equal(refreshed.modelList[0].name, "Model-2");

  // Concurrent calls share 1 in-flight request.
  const p1 = fetchModelCatalog({ cwd: "slow", useCache: true, fetcher });
  const p2 = fetchModelCatalog({ cwd: "slow", useCache: true, fetcher });
  await Promise.resolve();
  resolveSlow();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(requests, 3);
  assert.equal(r1.modelList[0].name, "Slow");
  assert.equal(r2.modelList[0].name, "Slow");

  // Partial results with modelError are not cached.
  await fetchModelCatalog({ cwd: "err", useCache: true, fetcher });
  await fetchModelCatalog({ cwd: "err", useCache: true, fetcher });
  assert.equal(requests, 5);

  clearModelCatalogCache();
});

test("a forced catalog refresh supersedes an older in-flight request for later callers and cache writes", async (t) => {
  t.after(clearModelCatalogCache);
  const pending = [];
  const options = {
    cwd: "refresh-race",
    useCache: true,
    fetcher: (url) => new Promise((resolve) => pending.push({ url, resolve })),
  };
  const older = fetchModelCatalog(options);
  const forced = fetchModelCatalog({ ...options, forceRefresh: true });
  const joined = fetchModelCatalog(options);
  await Promise.resolve();
  assert.deepEqual(pending.map(({ url }) => url), [
    "/api/models?cwd=refresh-race",
    "/api/models?cwd=refresh-race&refresh=1",
  ]);
  const oldData = { models: { "p:m": "Old" }, modelList: [{ id: "m", name: "Old", provider: "p" }] };
  const newData = { models: { "p:m": "New" }, modelList: [{ id: "m", name: "New", provider: "p" }] };
  pending[1].resolve(Response.json(newData));
  assert.deepEqual(await forced, newData);
  pending[0].resolve(Response.json(oldData));
  assert.deepEqual(await older, oldData);
  assert.deepEqual(await joined, newData);
  assert.deepEqual(await fetchModelCatalog(options), newData);
  assert.equal(pending.length, 2);
});

test("already aborted catalog callers cannot use a cache hit or start a new request", async (t) => {
  t.after(clearModelCatalogCache);
  let requests = 0;
  const options = {
    cwd: "cached-abort",
    useCache: true,
    fetcher: async () => {
      requests += 1;
      return Response.json({ models: { "p:m": "Model" }, modelList: [{ id: "m", name: "Model", provider: "p" }] });
    },
  };
  await fetchModelCatalog(options);
  const signal = AbortSignal.abort();
  await assert.rejects(fetchModelCatalog({ ...options, signal }), { name: "AbortError" });
  await assert.rejects(fetchModelCatalog({ ...options, cwd: "uncached-abort", signal }), { name: "AbortError" });
  assert.equal(requests, 1);
});

test("each model settings revision forces one request per workspace across chat remounts", async (t) => {
  t.after(clearModelCatalogCache);
  const urls = [];
  const options = {
    cwd: "workspace-a",
    useCache: true,
    fetcher: async (url) => {
      urls.push(url);
      return Response.json({ models: { "p:m": "Model" }, modelList: [{ id: "m", name: "Model", provider: "p" }] });
    },
  };
  await fetchModelCatalog(options);
  await Promise.all([
    fetchModelCatalog({ ...options, settingsRevision: 1 }),
    fetchModelCatalog({ ...options, settingsRevision: 1 }),
  ]);
  await fetchModelCatalog({ ...options, settingsRevision: 1 });
  await fetchModelCatalog({ ...options, settingsRevision: 2 });
  await fetchModelCatalog({ ...options, cwd: "workspace-b", settingsRevision: 2 });
  assert.deepEqual(urls, [
    "/api/models?cwd=workspace-a",
    "/api/models?cwd=workspace-a&refresh=1",
    "/api/models?cwd=workspace-a&refresh=1",
    "/api/models?cwd=workspace-b&refresh=1",
  ]);
});
