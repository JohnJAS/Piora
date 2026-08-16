import { mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import {
  isExtensionIdEnabled,
  setExtensionEnabled,
} from "./extension-config";

/**
 * Compatibility facade for the two first-party prompt-mode extensions. The
 * canonical source of truth is the unified extension preference store.
 *
 * The desktop app surfaces this through Settings → Extensions; disabling a
 * mode removes its module from the next AgentSession extension load plan.
 */
export interface PromptModeConfig {
  goalMode: boolean;
  planMode: boolean;
}

export const PROMPT_MODE_CONFIG_FILE = "prompt-modes.json";

export const DEFAULT_PROMPT_MODE_CONFIG: PromptModeConfig = {
  goalMode: true,
  planMode: true,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Parse a stored config payload, tolerating missing files and bad JSON. */
export function parsePromptModeConfig(raw: string | null | undefined): PromptModeConfig {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { ...DEFAULT_PROMPT_MODE_CONFIG };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_PROMPT_MODE_CONFIG };
    }
    const record = parsed as Record<string, unknown>;
    return {
      goalMode: asBoolean(record.goalMode, DEFAULT_PROMPT_MODE_CONFIG.goalMode),
      planMode: asBoolean(record.planMode, DEFAULT_PROMPT_MODE_CONFIG.planMode),
    };
  } catch {
    return { ...DEFAULT_PROMPT_MODE_CONFIG };
  }
}

export function promptModeConfigDir(baseDir?: string): string {
  return join(baseDir ?? getAgentDir(), "piora");
}

export function promptModeConfigPath(baseDir?: string): string {
  return join(promptModeConfigDir(baseDir), PROMPT_MODE_CONFIG_FILE);
}

export function readPromptModeConfig(baseDir?: string): PromptModeConfig {
  if (baseDir === undefined) {
    return {
      goalMode: isExtensionIdEnabled("piora:goal"),
      planMode: isExtensionIdEnabled("piora:plan"),
    };
  }
  try {
    return parsePromptModeConfig(readFileSync(promptModeConfigPath(baseDir), "utf8"));
  } catch {
    return { ...DEFAULT_PROMPT_MODE_CONFIG };
  }
}

/**
 * Merge a partial patch into the stored config and persist it atomically.
 * Returns the merged config so callers can respond with the effective state.
 */
export function writePromptModeConfig(patch: Partial<PromptModeConfig>, baseDir?: string): PromptModeConfig {
  if (baseDir === undefined) {
    if (typeof patch.goalMode === "boolean") setExtensionEnabled("piora:goal", patch.goalMode);
    if (typeof patch.planMode === "boolean") setExtensionEnabled("piora:plan", patch.planMode);
    return readPromptModeConfig();
  }
  const current = readPromptModeConfig(baseDir);
  const merged: PromptModeConfig = {
    goalMode: asBoolean(patch.goalMode, current.goalMode),
    planMode: asBoolean(patch.planMode, current.planMode),
  };
  const dir = promptModeConfigDir(baseDir);
  mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(promptModeConfigPath(baseDir), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}
