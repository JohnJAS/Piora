import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const sessionPrompt = await jiti.import("./session-system-prompt.ts");
const { FILE_REFERENCE_INSTRUCTIONS } = await jiti.import("./file-references.ts");

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
  assert.equal(sessionPrompt.resolveSessionSystemPrompt([
    { type: "custom", customType: sessionPrompt.SESSION_SYSTEM_PROMPT_ENTRY_TYPE, data: binding },
  ], undefined, emptyCatalog), undefined);
});

test("append helper preserves base entries without mutation and wraps optional prompt sections", () => {
  const baseAppend = ["existing addendum"];
  assert.deepEqual(sessionPrompt.buildSessionAppendSystemPrompt(baseAppend, {
    fileReferenceInstructions: "Use full paths.",
    subagentSystemPrompt: "Inspect only.",
    sideChatInstructions: "<side_conversation>Side chat</side_conversation>",
  }), [
    "existing addendum",
    "<file_references>\nUse full paths.\n</file_references>",
    "<subagent_role>\nInspect only.\n</subagent_role>",
    "<side_conversation>Side chat</side_conversation>",
  ]);
  assert.deepEqual(baseAppend, ["existing addendum"]);
});

test("SDK session retains native preamble, tools, rules and addendum when no custom template is set", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "piora-system-prompt-sdk-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const emptyCatalog = { ...catalog, templates: [], defaultTemplateId: null };

  const defaultManager = SessionManager.inMemory(root);
  sessionPrompt.appendSessionSystemPromptBinding(
    defaultManager,
    sessionPrompt.createSessionSystemPromptBinding({ mode: "default" }, emptyCatalog),
  );
  const defaultServices = await createAgentSessionServices({
    cwd: root,
    agentDir: root,
    settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: (base) => sessionPrompt.resolveSessionSystemPrompt(
        defaultManager.getEntries(),
        base,
        emptyCatalog,
      ),
      appendSystemPromptOverride: (baseAppend) => sessionPrompt.buildSessionAppendSystemPrompt(baseAppend, {
        fileReferenceInstructions: FILE_REFERENCE_INSTRUCTIONS,
      }),
    },
  });
  const { session: defaultSession } = await createAgentSessionFromServices({
    services: defaultServices,
    sessionManager: defaultManager,
  });
  t.after(() => defaultSession.dispose?.());

  const defaultPrompt = defaultSession.systemPrompt;
  assert.equal(defaultPrompt.includes("undefined"), false);
  assert.ok(defaultPrompt.startsWith("You are a coding assistant running inside pi"));
  assert.match(defaultPrompt, /<tools>/);
  assert.match(defaultPrompt, /<rules>/);
  assert.match(defaultPrompt, /Be concise in your responses/);
  assert.match(defaultPrompt, /Use edit for targeted changes/);
  assert.match(defaultPrompt, /<addendum>/);
  assert.match(defaultPrompt, /<file_references>/);

  const templateCatalog = {
    version: 2,
    templates: [{
      id: "reviewer",
      name: "Reviewer",
      prompt: "Review carefully.",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    }],
    defaultTemplateId: "reviewer",
    selectorVisible: true,
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
  const templateManager = SessionManager.inMemory(root);
  sessionPrompt.appendSessionSystemPromptBinding(
    templateManager,
    sessionPrompt.createSessionSystemPromptBinding({ mode: "template", templateId: "reviewer" }, templateCatalog),
  );
  const templateServices = await createAgentSessionServices({
    cwd: root,
    agentDir: root,
    settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: (base) => sessionPrompt.resolveSessionSystemPrompt(
        templateManager.getEntries(),
        base,
        templateCatalog,
      ),
      appendSystemPromptOverride: (baseAppend) => sessionPrompt.buildSessionAppendSystemPrompt(baseAppend, {
        fileReferenceInstructions: FILE_REFERENCE_INSTRUCTIONS,
      }),
    },
  });
  const { session: templateSession } = await createAgentSessionFromServices({
    services: templateServices,
    sessionManager: templateManager,
  });
  t.after(() => templateSession.dispose?.());

  const templatePrompt = templateSession.systemPrompt;
  assert.equal(templatePrompt.includes("undefined"), false);
  assert.ok(templatePrompt.startsWith("Review carefully."));
  assert.match(templatePrompt, /<addendum>/);
  assert.match(templatePrompt, /<file_references>/);
});
