import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const plugins = readFileSync(new URL("./PluginsConfig.tsx", import.meta.url), "utf8");
const extensions = readFileSync(new URL("./ExtensionsConfig.tsx", import.meta.url), "utf8");
const skills = readFileSync(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");
const companions = readFileSync(new URL("./CompanionSettingsDialog.tsx", import.meta.url), "utf8");

test("extension, skill, and plugin pages explain the Pi capability model", () => {
  assert.match(extensions, /<CapabilityPrimer current="extension"/);
  assert.match(skills, /<CapabilityPrimer current="skill"/);
  assert.match(plugins, /<CapabilityPrimer current="plugin"/);
});

test("plugin package resources use cards instead of a modal backdrop", () => {
  const resourceList = plugins.slice(
    plugins.indexOf("function ResourceList"),
    plugins.indexOf("function McpCapabilities"),
  );
  assert.match(resourceList, /styles\.resourceGrid/);
  assert.doesNotMatch(resourceList, /app-shell-dialog-backdrop/);
  assert.match(plugins, /plugins\.mcpCapabilities/);
});

test("pet rows render real sprite previews", () => {
  assert.match(companions, /function PetPreview/);
  assert.match(companions, /backgroundPosition/);
  assert.equal((companions.match(/<PetPreview pet=\{pet\}/g) ?? []).length, 2);
});
