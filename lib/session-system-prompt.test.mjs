import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const sessionPrompt = await jiti.import("./session-system-prompt.ts");

const catalog = {
  version: 2,
  templates: [{
    id: "reviewer",
    name: "Reviewer",
    prompt: "Review carefully.",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  }],
  defaultTemplateId: "reviewer",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

test("conversation bindings keep a prompt snapshot after templates change", () => {
  const binding = sessionPrompt.createSessionSystemPromptBinding({ mode: "template", templateId: "reviewer" }, catalog);
  const entries = [{ type: "custom", customType: sessionPrompt.SESSION_SYSTEM_PROMPT_ENTRY_TYPE, data: binding }];
  catalog.templates[0].prompt = "Changed later.";

  assert.equal(sessionPrompt.resolveSessionSystemPrompt(entries, "PI DEFAULT", catalog), "Review carefully.");
  assert.equal(sessionPrompt.readLatestSessionSystemPromptBinding(entries).templateName, "Reviewer");
});

test("a default binding snapshots Pi default when no template is configured", () => {
  const emptyCatalog = { ...catalog, templates: [], defaultTemplateId: null };
  const binding = sessionPrompt.createSessionSystemPromptBinding({ mode: "default" }, emptyCatalog);
  assert.equal(binding.prompt, null);
  assert.equal(sessionPrompt.resolveSessionSystemPrompt([
    { type: "custom", customType: sessionPrompt.SESSION_SYSTEM_PROMPT_ENTRY_TYPE, data: binding },
  ], "PI DEFAULT", emptyCatalog), "PI DEFAULT");
});
