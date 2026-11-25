import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "../atomic-file.ts";
import {
  createCliAlignedPresetSettings,
  createDefaultRuntimePromptSettings,
  DEFAULT_RUNTIME_PROMPT_SETTINGS,
  RUNTIME_PROMPT_EXTENSION_KEYS,
  type RuntimePromptExtensionKey,
  type RuntimePromptSettings,
  type RuntimePromptSettingsPatch,
} from "./types.ts";

export {
  createCliAlignedPresetSettings,
  createDefaultRuntimePromptSettings,
  DEFAULT_RUNTIME_PROMPT_SETTINGS,
  RUNTIME_PROMPT_EXTENSION_KEYS,
  type RuntimePromptExtensionKey,
  type RuntimePromptSettings,
  type RuntimePromptSettingsPatch,
};

const EXTENSION_KEY_SET = new Set<string>(RUNTIME_PROMPT_EXTENSION_KEYS);
const TOP_LEVEL_KEY_SET = new Set(["version", "mergeCompact", "alignCliCompaction", "extensions"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function runtimePromptSettingsPath(agentDir = getAgentDir()): string {
  return join(agentDir, "piora", "runtime-prompt.json");
}

export function readRuntimePromptSettings(agentDir = getAgentDir()): RuntimePromptSettings {
  const path = runtimePromptSettingsPath(agentDir);
  if (!existsSync(path)) return createDefaultRuntimePromptSettings();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isPlainObject(parsed)) return createDefaultRuntimePromptSettings();
    const result = createDefaultRuntimePromptSettings();
    if (typeof parsed.mergeCompact === "boolean") result.mergeCompact = parsed.mergeCompact;
    if (typeof parsed.alignCliCompaction === "boolean") result.alignCliCompaction = parsed.alignCliCompaction;
    if (isPlainObject(parsed.extensions)) {
      for (const key of RUNTIME_PROMPT_EXTENSION_KEYS) {
        if (typeof parsed.extensions[key] === "boolean") {
          result.extensions[key] = parsed.extensions[key];
        }
      }
    }
    return result;
  } catch {
    return createDefaultRuntimePromptSettings();
  }
}

export function parseRuntimePromptSettingsPatch(raw: unknown): RuntimePromptSettingsPatch {
  if (!isPlainObject(raw)) {
    throw new TypeError("Runtime prompt settings payload must be an object.");
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    throw new TypeError("Runtime prompt settings payload must include at least one setting.");
  }
  for (const key of keys) {
    if (!TOP_LEVEL_KEY_SET.has(key)) {
      throw new TypeError(`Unknown runtime prompt setting: ${key}`);
    }
  }
  if (raw.version !== undefined && raw.version !== 1) {
    throw new TypeError("Runtime prompt settings version must be 1.");
  }

  const patch: RuntimePromptSettingsPatch = {};
  if (raw.mergeCompact !== undefined) {
    if (typeof raw.mergeCompact !== "boolean") throw new TypeError("mergeCompact must be a boolean.");
    patch.mergeCompact = raw.mergeCompact;
  }
  if (raw.alignCliCompaction !== undefined) {
    if (typeof raw.alignCliCompaction !== "boolean") throw new TypeError("alignCliCompaction must be a boolean.");
    patch.alignCliCompaction = raw.alignCliCompaction;
  }
  if (raw.extensions !== undefined) {
    if (!isPlainObject(raw.extensions)) {
      throw new TypeError("extensions must be an object.");
    }
    const extensions: Partial<Record<RuntimePromptExtensionKey, boolean>> = {};
    for (const [key, value] of Object.entries(raw.extensions)) {
      if (!EXTENSION_KEY_SET.has(key)) {
        throw new TypeError(`Unknown runtime prompt extension key: ${key}`);
      }
      if (typeof value !== "boolean") {
        throw new TypeError(`Extension toggle "${key}" must be a boolean.`);
      }
      extensions[key as RuntimePromptExtensionKey] = value;
    }
    patch.extensions = extensions;
  }
  return patch;
}

export function writeRuntimePromptSettings(patch: unknown, agentDir = getAgentDir()): RuntimePromptSettings {
  const validated = parseRuntimePromptSettingsPatch(patch);
  const current = readRuntimePromptSettings(agentDir);
  const next: RuntimePromptSettings = {
    version: 1,
    mergeCompact: validated.mergeCompact ?? current.mergeCompact,
    alignCliCompaction: validated.alignCliCompaction ?? current.alignCliCompaction,
    extensions: {
      ...current.extensions,
      ...(validated.extensions ?? {}),
    },
  };
  const path = runtimePromptSettingsPath(agentDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
