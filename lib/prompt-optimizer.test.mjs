import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  PROMPT_OPTIMIZER_MAX_OUTPUT_LENGTH,
  PROMPT_OPTIMIZER_SYSTEM_PROMPT,
  parseOptimizedPrompt,
} = await jiti.import("./prompt-optimizer.ts");

test("cleans common optimized prompt response wrappers", () => {
  assert.equal(parseOptimizedPrompt("```text\nBuild the settings page.\n```"), "Build the settings page.");
  assert.equal(parseOptimizedPrompt('{"optimizedPrompt":"Keep the API stable."}'), "Keep the API stable.");
  assert.equal(parseOptimizedPrompt('“保留现有接口并补充测试。”'), "保留现有接口并补充测试。");
});

test("rejects an empty optimized prompt and caps oversized output", () => {
  assert.throws(() => parseOptimizedPrompt("   "), /did not return/);
  assert.equal(parseOptimizedPrompt("a".repeat(PROMPT_OPTIMIZER_MAX_OUTPUT_LENGTH + 50)).length, PROMPT_OPTIMIZER_MAX_OUTPUT_LENGTH);
});

test("optimizer instructions preserve user intent and prohibit invented requirements", () => {
  assert.match(PROMPT_OPTIMIZER_SYSTEM_PROMPT, /Preserve the user's intent/);
  assert.match(PROMPT_OPTIMIZER_SYSTEM_PROMPT, /do not invent requirements/);
  assert.match(PROMPT_OPTIMIZER_SYSTEM_PROMPT, /Return only the optimized prompt/);
});

test("optimizer route uses the selected runtime without adding tools or session messages", async () => {
  const route = await readFile(new URL("../app/api/prompts/optimize/route.ts", import.meta.url), "utf8");
  assert.match(route, /isApiRequestAllowed\(request\)/);
  assert.match(route, /parseJsonWithinLimit/);
  assert.match(route, /resolveModelRequestCwd/);
  assert.match(route, /modelRuntime\.completeSimple/);
  assert.match(route, /systemPrompt: optimizerSystemPrompt/);
  assert.match(route, /body\.systemPrompt/);
  assert.match(route, /PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH/);
  assert.doesNotMatch(route, /startRpcSession|session\.prompt/);
});
