import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SettingsManager } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url);
const config = await jiti.import("./extension-config.ts");
const firstParty = await jiti.import("./first-party-extensions.ts");

function fakeExtension(path, sourceInfo = { path, source: "cli", scope: "temporary", origin: "top-level" }) {
  return {
    path,
    resolvedPath: path,
    sourceInfo,
    handlers: new Map(),
    tools: new Map([["sample_tool", {}]]),
    messageRenderers: new Map(),
    commands: new Map([["sample", {}]]),
    flags: new Map(),
    shortcuts: new Map(),
  };
}

test("extension preferences persist an idempotent disabled set", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-extension-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "nested", "extensions.json");

  config.setExtensionEnabled("piora:plan", false, path);
  config.setExtensionEnabled("piora:plan", false, path);
  assert.deepEqual(config.readExtensionPreferences(path).disabled, ["piora:plan"]);
  config.setExtensionEnabled("piora:plan", true, path);
  assert.deepEqual(config.readExtensionPreferences(path).disabled, []);
  assert.equal(JSON.parse(await readFile(path, "utf8")).version, 1);
});

test("inventory and runtime filtering share the same stable extension identity", () => {
  const planPath = firstParty.firstPartyExtensionPath(
    firstParty.FIRST_PARTY_EXTENSIONS.find(({ id }) => id === "piora:plan"),
  );
  const extension = fakeExtension(planPath);
  const preferences = { version: 1, disabled: ["piora:plan"] };
  const result = { extensions: [extension], errors: [], runtime: {} };

  assert.equal(config.extensionId(extension), "piora:plan");
  assert.equal(config.buildExtensionInventory([extension], preferences)[0].enabled, false);
  assert.deepEqual(config.filterConfiguredExtensions(result, preferences).extensions, []);
});

test("a user extension cannot impersonate a first-party extension by filename", () => {
  const path = join(tmpdir(), "untrusted", "piora-plan.ts");
  const extension = fakeExtension(path, {
    path,
    source: path,
    scope: "user",
    origin: "top-level",
  });
  assert.notEqual(config.extensionId(extension), "piora:plan");
  assert.match(config.extensionId(extension), /^path:user:/);
});

test("the pre-load plan excludes disabled extension modules before Pi executes them", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "piora-extension-plan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  const extensionsDir = join(agentDir, "extensions");
  await mkdir(extensionsDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  const disabledPath = join(extensionsDir, "disabled.ts");
  await writeFile(disabledPath, "throw new Error('disabled extension executed');\nexport default function () {}\n", "utf8");

  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const initial = await config.resolveExtensionLoadPlan({
    cwd,
    agentDir,
    settingsManager,
    profile: "normal",
    preferences: { version: 1, disabled: [] },
  });
  const candidate = initial.candidates.find(({ path }) => path === disabledPath);
  assert.ok(candidate);

  const filtered = await config.resolveExtensionLoadPlan({
    cwd,
    agentDir,
    settingsManager,
    profile: "normal",
    preferences: { version: 1, disabled: [candidate.id] },
  });
  assert.ok(filtered.candidates.some(({ id, enabled }) => id === candidate.id && !enabled));
  assert.equal(filtered.enabledPaths.includes(disabledPath), false);
});
