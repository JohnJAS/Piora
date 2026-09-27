import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOL_DEFINITION_PROMPT_TOKEN_LIMIT,
  estimateToolDefinitionPromptTokens,
  fitToolNamesWithinDefinitionBudget,
  measureToolDefinitionPromptBytes,
} from "./tool-definition-budget.ts";

const tool = (name, size) => ({
  name,
  description: name,
  parameters: { type: "object", properties: { value: { type: "string", description: "x".repeat(size) } } },
});

test("tool prompt measurement uses the same compact provider payload", () => {
  const definitions = [tool("read", 100), tool("write", 200)];
  const bytes = measureToolDefinitionPromptBytes(definitions);

  assert.ok(bytes > 300);
  assert.ok(estimateToolDefinitionPromptTokens(definitions) > 0);
  assert.equal(TOOL_DEFINITION_PROMPT_TOKEN_LIMIT, 10_000);
});

test("tool selection never crosses the hard 10k serialized prompt limit", () => {
  const definitions = [tool("first", 10_000), tool("second", 10_000), tool("oversized", 32_000)];
  const result = fitToolNamesWithinDefinitionBudget(definitions, ["first", "second", "oversized"]);

  assert.deepEqual(result.toolNames, ["first", "second"]);
  assert.deepEqual(result.droppedToolNames, ["oversized"]);
  assert.ok(result.promptTokens <= TOOL_DEFINITION_PROMPT_TOKEN_LIMIT);
});

test("tool budget selection is stable and ignores duplicate or unknown names", () => {
  const definitions = [tool("read", 50), tool("write", 50)];
  const result = fitToolNamesWithinDefinitionBudget(definitions, ["write", "missing", "write", "read"]);

  assert.deepEqual(result.toolNames, ["write", "read"]);
  assert.deepEqual(result.droppedToolNames, []);
});

function referenceFit(tools, names, tokenLimit) {
  const definitions = new Map();
  for (const item of tools) if (typeof item.name === "string" && !definitions.has(item.name)) definitions.set(item.name, item);
  const toolNames = [], droppedToolNames = [], seen = new Set();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (!definitions.has(name)) continue;
    const next = [...toolNames, name].map(key => definitions.get(key));
    if (estimateToolDefinitionPromptTokens(next) <= tokenLimit) toolNames.push(name); else droppedToolNames.push(name);
  }
  const selected = toolNames.map(key => definitions.get(key));
  return { toolNames, droppedToolNames, promptBytes: measureToolDefinitionPromptBytes(selected), promptTokens: estimateToolDefinitionPromptTokens(selected), tokenLimit };
}

test("linear budget accounting exactly matches full serialization across UTF-8 and limit boundaries", () => {
  const cycle = {}; cycle.self = cycle;
  const definitions = [
    ...Array.from({ length: 80 }, (_, id) => ({ name: `工具-${id}😀`, description: "中文\\\n😀".repeat(id), inputSchema: { type: "object", properties: { value: { enum: [null, true, "é", "\ud800"] } } } })),
    { name: "broken", parameters: cycle }, { name: "bigint", parameters: { value: 1n } },
    { name: "optional" }, { name: "optional", description: "ignored duplicate" },
  ];
  const names = ["unknown", ...definitions.map(item => item.name), "工具-1😀"];
  for (const limit of [0, 1, 2, 40, 41, 42, 100, 999, 1000, 10000, Infinity]) {
    assert.deepEqual(fitToolNamesWithinDefinitionBudget(definitions, names, limit), referenceFit(definitions, names, limit));
  }
});

test("large inventories serialize each candidate only once", () => {
  let reads = 0;
  const definitions = Array.from({ length: 200 }, (_, id) => ({ name: `tool-${id}`, parameters: { toJSON() { reads++; return { type: "object" }; } } }));
  const result = fitToolNamesWithinDefinitionBudget(definitions, definitions.map(item => item.name), 10000);
  assert.equal(result.toolNames.length, definitions.length); assert.equal(reads, definitions.length);
});
