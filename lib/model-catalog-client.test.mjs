import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { fetchModelCatalog } = await jiti.import("./model-catalog-client.ts");

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
