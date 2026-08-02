import assert from "node:assert/strict";
import test from "node:test";

import { estimateSessionContextUsage } from "./context-usage.ts";

test("estimates context from the latest assistant usage plus trailing messages", () => {
  const usage = estimateSessionContextUsage([
    { role: "user", content: "old message" },
    {
      role: "assistant",
      provider: "openai",
      model: "gpt-5",
      content: [{ type: "text", text: "answer" }],
      usage: {
        input: 1_000,
        output: 200,
        cacheRead: 500,
        cacheWrite: 100,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
    { role: "user", content: "12345678" },
  ], 10_000);

  assert.deepEqual(usage, { tokens: 1_802, contextWindow: 10_000, percent: 18.02 });
});

test("estimates a new session without assistant usage", () => {
  const usage = estimateSessionContextUsage([
    { role: "user", content: "12345678" },
  ], 100);

  assert.deepEqual(usage, { tokens: 2, contextWindow: 100, percent: 2 });
  assert.equal(estimateSessionContextUsage([], 0), null);
});
