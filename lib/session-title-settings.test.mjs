import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const settings = await jiti.import("./session-title-settings.ts");
const prompt = await jiti.import("./session-title-prompt.ts");

test("session title instructions persist, normalize, restore, and fall back safely", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  assert.equal(settings.readSessionTitlePrompt(storage), settings.SESSION_TITLE_PROMPT);
  assert.equal(settings.writeSessionTitlePrompt("  custom title instructions  ", storage), "custom title instructions");
  assert.equal(settings.readSessionTitlePrompt(storage), "custom title instructions");
  assert.equal(settings.resetSessionTitlePrompt(storage), settings.SESSION_TITLE_PROMPT);
  assert.equal(settings.readSessionTitlePrompt(storage), settings.SESSION_TITLE_PROMPT);
  assert.equal(settings.readSessionTitlePrompt({ getItem: () => { throw new Error("blocked"); } }), settings.SESSION_TITLE_PROMPT);
});

test("session title model preference persists and rejects invalid stored values", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  assert.equal(settings.readSessionTitleModel(storage), null);
  assert.deepEqual(
    settings.writeSessionTitleModel({ provider: " openai ", modelId: " gpt-5.4-mini " }, storage),
    { provider: "openai", modelId: "gpt-5.4-mini" },
  );
  assert.deepEqual(settings.readSessionTitleModel(storage), { provider: "openai", modelId: "gpt-5.4-mini" });
  values.set(settings.SESSION_TITLE_MODEL_STORAGE_KEY, "not json");
  assert.equal(settings.readSessionTitleModel(storage), null);
  assert.equal(settings.resetSessionTitleModel(storage), null);
});

test("session title requests include the editable draft without replacing custom instructions", () => {
  const request = prompt.buildSessionTitleRequest("Use a compact technical title.", "Old session title");
  assert.match(request, /^Use a compact technical title\./);
  assert.match(request, /Current title draft:\nOld session title$/);
});
