import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { writePrivateFileAtomicSync } from "./atomic-file";

const SYSTEM_PROMPT_CONFIG_VERSION = 1;
export const SYSTEM_PROMPT_MAX_LENGTH = 100_000;

export interface SystemPromptConfig {
  version: typeof SYSTEM_PROMPT_CONFIG_VERSION;
  prompt: string | null;
  updatedAt: string | null;
}
export function systemPromptConfigPath(agentDir = getAgentDir()): string {
  return resolve(agentDir, "piora", "system-prompt.json");
}

export function readSystemPromptConfig(path = systemPromptConfigPath()): SystemPromptConfig {
  try {
    if (!existsSync(path)) return { version: SYSTEM_PROMPT_CONFIG_VERSION, prompt: null, updatedAt: null };
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SystemPromptConfig>;
    if (parsed.version !== SYSTEM_PROMPT_CONFIG_VERSION) {
      return { version: SYSTEM_PROMPT_CONFIG_VERSION, prompt: null, updatedAt: null };
    }
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt : null;
    if (prompt !== null && (prompt.length > SYSTEM_PROMPT_MAX_LENGTH || prompt.includes("\0"))) {
      return { version: SYSTEM_PROMPT_CONFIG_VERSION, prompt: null, updatedAt: null };
    }
    return {
      version: SYSTEM_PROMPT_CONFIG_VERSION,
      prompt,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return { version: SYSTEM_PROMPT_CONFIG_VERSION, prompt: null, updatedAt: null };
  }
}

export function writeSystemPromptConfig(
  prompt: string | null,
  path = systemPromptConfigPath(),
): SystemPromptConfig {
  if (prompt !== null && prompt.length > SYSTEM_PROMPT_MAX_LENGTH) {
    throw new Error(`System prompt must not exceed ${SYSTEM_PROMPT_MAX_LENGTH} characters.`);
  }
  if (prompt?.includes("\0")) throw new Error("System prompt must not contain null characters.");
  const next: SystemPromptConfig = {
    version: SYSTEM_PROMPT_CONFIG_VERSION,
    prompt,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
