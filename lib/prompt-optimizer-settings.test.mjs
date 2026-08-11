import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const settings = await createJiti(import.meta.url).import("./prompt-optimizer-settings.ts");

test("prompt optimizer settings persist, normalize, restore, and fall back safely", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  assert.equal(settings.readPromptOptimizerSystemPrompt(storage), settings.PROMPT_OPTIMIZER_SYSTEM_PROMPT);
  assert.equal(settings.writePromptOptimizerSystemPrompt("  custom instructions  ", storage), "custom instructions");
  assert.equal(settings.readPromptOptimizerSystemPrompt(storage), "custom instructions");
  assert.equal(settings.resetPromptOptimizerSystemPrompt(storage), settings.PROMPT_OPTIMIZER_SYSTEM_PROMPT);
  assert.equal(settings.readPromptOptimizerSystemPrompt(storage), settings.PROMPT_OPTIMIZER_SYSTEM_PROMPT);
  assert.equal(settings.readPromptOptimizerSystemPrompt({ getItem: () => { throw new Error("blocked"); } }), settings.PROMPT_OPTIMIZER_SYSTEM_PROMPT);
});
