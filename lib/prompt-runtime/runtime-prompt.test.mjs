import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const {
  createCliAlignedPresetSettings,
  createDefaultRuntimePromptSettings,
  DEFAULT_RUNTIME_PROMPT_SETTINGS,
  parseRuntimePromptSettingsPatch,
  readRuntimePromptSettings,
  runtimePromptSettingsPath,
  writeRuntimePromptSettings,
} = await jiti.import("./settings.ts");
const {
  applyExtensionPromptGuidance,
  mergeRuntimePromptEntry,
  RUNTIME_ENTRY_LABELS,
} = await jiti.import("./capabilities.ts");
const { buildSessionAppendSystemPrompt } = await jiti.import("../session-system-prompt.ts");
const { FILE_REFERENCE_INSTRUCTIONS } = await jiti.import("../file-references.ts");
const { firstPartyExtensionPath } = await jiti.import("../first-party-extensions.ts");

function withTempAgentDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "piora-runtime-prompt-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("runtime prompt settings default off for conflicting rules and validate patches strictly", (t) => {
  const agentDir = withTempAgentDir(t);
  const defaults = readRuntimePromptSettings(agentDir);
  assert.deepEqual(defaults, DEFAULT_RUNTIME_PROMPT_SETTINGS);
  assert.equal(defaults.mergeCompact, true);
  assert.equal(defaults.alignCliCompaction, true);
  assert.equal(defaults.extensions.fileTools, false);
  assert.equal(defaults.extensions.fileReferences, false);
  assert.equal(defaults.extensions.userInput, false);

  assert.throws(() => parseRuntimePromptSettingsPatch(null), /object/);
  assert.throws(() => parseRuntimePromptSettingsPatch([]), /object/);
  assert.throws(() => parseRuntimePromptSettingsPatch({}), /at least one/);
  assert.throws(() => parseRuntimePromptSettingsPatch({ unknownKey: true }), /Unknown runtime prompt setting/);
  assert.throws(() => parseRuntimePromptSettingsPatch({ mergeCompact: "yes" }), /boolean/);
  assert.throws(() => parseRuntimePromptSettingsPatch({ alignCliCompaction: 1 }), /boolean/);
  assert.throws(() => parseRuntimePromptSettingsPatch({ extensions: { bogus: true } }), /Unknown runtime prompt extension/);
  assert.throws(() => parseRuntimePromptSettingsPatch({ extensions: { browser: "true" } }), /boolean/);

  const updated = writeRuntimePromptSettings({
    mergeCompact: false,
    extensions: { fileTools: true, browser: false },
  }, agentDir);
  assert.equal(updated.mergeCompact, false);
  assert.equal(updated.alignCliCompaction, true);
  assert.equal(updated.extensions.fileTools, true);
  assert.equal(updated.extensions.browser, false);
  assert.equal(updated.extensions.userInput, false);
  assert.deepEqual(readRuntimePromptSettings(agentDir), updated);

  // Corrupt JSON gracefully falls back to defaults.
  mkdirSync(join(agentDir, "piora"), { recursive: true });
  writeFileSync(runtimePromptSettingsPath(agentDir), "{not json", "utf8");
  assert.deepEqual(readRuntimePromptSettings(agentDir), createDefaultRuntimePromptSettings());
});

test("applyExtensionPromptGuidance merges entries into one <piora_runtime> block and strips toolGuidelines", () => {
  const settings = createDefaultRuntimePromptSettings();
  settings.extensions.automations = true;

  const event = {
    systemPrompt: "BASE",
    systemPromptOptions: {
      selectedTools: ["browser", "piora_automation", "piora_request_user_input"],
      appendSystemPrompt: "User note",
      toolGuidelines: {
        browser: ["Long browser guideline"],
        piora_automation: ["Long automation guideline"],
        piora_request_user_input: ["Long user input guideline"],
        edit: ["SDK edit guideline"],
      },
    },
  };

  assert.equal(applyExtensionPromptGuidance(event, {
    key: "browser",
    toolNames: ["browser"],
    active: true,
    settings,
  }), undefined);
  assert.equal(applyExtensionPromptGuidance(event, {
    key: "automations",
    toolNames: ["piora_automation"],
    active: true,
    settings,
  }), undefined);
  assert.equal(applyExtensionPromptGuidance(event, {
    key: "userInput",
    toolNames: ["piora_request_user_input"],
    active: true,
    settings,
  }), undefined);
  // Idempotent on repeat call.
  assert.equal(applyExtensionPromptGuidance(event, {
    key: "browser",
    toolNames: ["browser"],
    active: true,
    settings,
  }), undefined);

  const appended = event.systemPromptOptions.appendSystemPrompt;
  assert.equal(appended.match(/<piora_runtime>/g)?.length, 1);
  assert.equal(appended.match(/<\/piora_runtime>/g)?.length, 1);
  assert.match(appended, /^User note\n\n<piora_runtime>/);
  assert.match(appended, /- browser:/);
  assert.match(appended, /- piora_automation:/);
  assert.doesNotMatch(appended, /piora_request_user_input/);
  assert.doesNotMatch(appended, /Never claim/i);
  assert.deepEqual(Object.keys(event.systemPromptOptions.toolGuidelines), ["edit"]);

  // Expanded mode preserves toolGuidelines for enabled active tools and uses separate blocks.
  const expandedSettings = createDefaultRuntimePromptSettings();
  expandedSettings.mergeCompact = false;
  const expandedEvent = {
    systemPrompt: "BASE",
    systemPromptOptions: {
      selectedTools: ["browser", "piora_request_user_input"],
      appendSystemPrompt: "",
      toolGuidelines: {
        browser: ["Keep me"],
        piora_request_user_input: ["Strip me because userInput is disabled"],
      },
    },
  };
  applyExtensionPromptGuidance(expandedEvent, {
    key: "browser",
    toolNames: ["browser"],
    active: true,
    settings: expandedSettings,
  });
  applyExtensionPromptGuidance(expandedEvent, {
    key: "userInput",
    toolNames: ["piora_request_user_input"],
    active: true,
    settings: expandedSettings,
  });
  assert.match(expandedEvent.systemPromptOptions.appendSystemPrompt, /<piora_capability name="browser">/);
  assert.deepEqual(Object.keys(expandedEvent.systemPromptOptions.toolGuidelines), ["browser"]);
});

test("mergeRuntimePromptEntry handles whitespace and deduplication cleanly", () => {
  const first = mergeRuntimePromptEntry("", RUNTIME_ENTRY_LABELS.ssh, "Remote\n  operations");
  const second = mergeRuntimePromptEntry(first, RUNTIME_ENTRY_LABELS.ssh, "Duplicate");
  assert.equal(first, "<piora_runtime>\n- ssh: Remote operations\n</piora_runtime>");
  assert.equal(second, first);
});

test("SDK session places <addendum> before <project_context>, skips disabled extensions, and bounds overhead", async (t) => {
  const agentDir = withTempAgentDir(t);
  const workspace = mkdtempSync(join(tmpdir(), "piora-sdk-prompt-order-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(join(workspace, "AGENTS.md"), "# Project Rules\nPrefer ripgrep directly.\n", "utf8");

  const extensionPaths = [
    firstPartyExtensionPath({ fileName: "piora-browser.ts" }),
    firstPartyExtensionPath({ fileName: "piora-automations.ts" }),
    firstPartyExtensionPath({ fileName: "piora-user-input.ts" }),
    firstPartyExtensionPath({ fileName: "piora-file-changes.ts" }),
    firstPartyExtensionPath({ fileName: "piora-ssh.ts" }),
  ];

  // 1. Default settings: browser + ssh enabled; fileTools/fileReferences/userInput/automations disabled.
  const manager = SessionManager.inMemory(workspace);
  const services = await createAgentSessionServices({
    cwd: workspace,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      additionalExtensionPaths: extensionPaths,
      appendSystemPromptOverride: (baseAppend) => buildSessionAppendSystemPrompt(baseAppend, {
        fileReferenceInstructions: readRuntimePromptSettings(agentDir).extensions.fileReferences
          ? FILE_REFERENCE_INSTRUCTIONS
          : undefined,
      }),
    },
  });
  const { session } = await createAgentSessionFromServices({ services, sessionManager: manager });
  t.after(() => session.dispose?.());

  const beforeResult = await session.extensionRunner.emitBeforeAgentStart(
    { type: "before_agent_start", prompt: "test" },
    session._baseSystemPromptOptions,
  );
  assert.equal(beforeResult.systemPromptOptions.forceSystemPrompt, undefined);
  const addendum = beforeResult.systemPromptOptions.appendSystemPrompt;
  assert.match(addendum, /<piora_runtime>/);
  assert.match(addendum, /- browser:/);
  assert.match(addendum, /- ssh:/);
  assert.doesNotMatch(addendum, /piora_automation/);
  assert.doesNotMatch(addendum, /piora_request_user_input/);
  assert.doesNotMatch(addendum, /file_tools/);
  assert.doesNotMatch(addendum, /<file_references>/);
  assert.ok(addendum.length < 400, `Default runtime addendum should stay compact, got ${addendum.length} chars`);

  const updateMessage = session._preparePromptAndToolLoadout(beforeResult.systemPromptOptions);
  session._runSystemPromptOptions = beforeResult.systemPromptOptions;
  assert.ok(updateMessage?.sections?.addendum);
  assert.match(updateMessage.sections.addendum, /<piora_runtime>/);
  const renderedPrompt = session.systemPrompt;
  const addendumIndex = renderedPrompt.indexOf("<addendum>");
  const projectContextIndex = renderedPrompt.indexOf("<project_context>");
  assert.ok(addendumIndex >= 0 && projectContextIndex > addendumIndex, "<addendum> must precede <project_context> (AGENTS.md)");
  assert.match(renderedPrompt, /Prefer ripgrep directly\./);
  assert.doesNotMatch(renderedPrompt, /instead of shell grep/i);

  // 2. Even with every extension toggle enabled in mergeCompact mode, Piora additions stay under 1800 chars.
  const allOn = {
    browser: true,
    automations: true,
    userInput: true,
    fileTools: true,
    fileReferences: false,
    subagents: true,
    ssh: true,
    harmony: true,
    computer: true,
    room: true,
    meme: true,
  };
  writeRuntimePromptSettings({ mergeCompact: true, extensions: allOn }, agentDir);
  const allEvent = {
    systemPrompt: "BASE",
    systemPromptOptions: {
      selectedTools: ["read", "bash", "edit", "write", "grep", "find", "ls", "browser", "piora_automation", "piora_request_user_input", "ssh", "harmony_control", "computer_control", "piora_room", "send_meme"],
      appendSystemPrompt: "",
      toolGuidelines: {},
    },
  };
  for (const key of ["browser", "automations", "userInput", "fileTools", "subagents", "ssh", "harmony", "computer", "room", "meme"]) {
    applyExtensionPromptGuidance(allEvent, { key, toolNames: [], active: true });
  }
  assert.ok(
    allEvent.systemPromptOptions.appendSystemPrompt.length < 1800,
    `Merged all-on runtime block must stay under 1800 chars, got ${allEvent.systemPromptOptions.appendSystemPrompt.length}`,
  );

  // 3. CLI-aligned preset injects zero Piora runtime text.
  const cliSettings = createCliAlignedPresetSettings();
  const cliEvent = {
    systemPrompt: "BASE",
    systemPromptOptions: {
      selectedTools: ["read", "bash", "edit", "write", "browser", "piora_automation", "piora_request_user_input"],
      appendSystemPrompt: "",
      toolGuidelines: { browser: ["g"], piora_automation: ["g"] },
    },
  };
  for (const key of ["browser", "automations", "userInput", "fileTools", "subagents", "ssh", "harmony", "computer", "room", "meme"]) {
    applyExtensionPromptGuidance(cliEvent, { key, toolNames: ["browser", "piora_automation"], active: true, settings: cliSettings });
  }
  assert.equal(cliEvent.systemPromptOptions.appendSystemPrompt, "");
  assert.deepEqual(cliEvent.systemPromptOptions.toolGuidelines, {});
});
