import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const policy = await jiti.import("./prompt-input-policy.ts");

test("estimates dense scripts conservatively and reserves output context", () => {
  assert.equal(policy.estimatePromptTokens("abcd"), 1);
  assert.equal(policy.estimatePromptTokens("你好世界"), 4);
  assert.equal(policy.getDirectPromptTokenBudget({ contextWindow: 100_000, tokens: 40_000 }), 45_000);
  assert.equal(policy.getDirectPromptTokenBudget({ contextWindow: 20_000, tokens: 18_000 }), 1_024);
});

test("materializes direct prompts that exceed transport or remaining context", () => {
  assert.equal(policy.shouldMaterializeDirectPrompt("short", { contextWindow: 100_000, tokens: 1_000 }), false);
  assert.equal(policy.shouldMaterializeDirectPrompt("你".repeat(20_000), { contextWindow: 32_000, tokens: 10_000 }), true);
  assert.equal(policy.shouldMaterializeDirectPrompt("x".repeat(policy.DIRECT_PROMPT_TRANSPORT_BYTES + 1), null), true);
});
