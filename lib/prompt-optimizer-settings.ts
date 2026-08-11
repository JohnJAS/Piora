import {
  PROMPT_OPTIMIZER_SYSTEM_PROMPT,
  PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH,
} from "./prompt-optimizer";

export { PROMPT_OPTIMIZER_SYSTEM_PROMPT } from "./prompt-optimizer";

export const PROMPT_OPTIMIZER_STORAGE_KEY = "piora-prompt-optimizer-system-prompt-v1";

export function normalizePromptOptimizerSystemPrompt(value: unknown): string {
  if (typeof value !== "string") return PROMPT_OPTIMIZER_SYSTEM_PROMPT;
  const normalized = value.trim();
  if (!normalized) return PROMPT_OPTIMIZER_SYSTEM_PROMPT;
  return Array.from(normalized).slice(0, PROMPT_OPTIMIZER_MAX_SYSTEM_PROMPT_LENGTH).join("");
}

export function readPromptOptimizerSystemPrompt(storage?: Pick<Storage, "getItem">): string {
  if (!storage) return PROMPT_OPTIMIZER_SYSTEM_PROMPT;
  try {
    return normalizePromptOptimizerSystemPrompt(storage.getItem(PROMPT_OPTIMIZER_STORAGE_KEY));
  } catch {
    return PROMPT_OPTIMIZER_SYSTEM_PROMPT;
  }
}

export function writePromptOptimizerSystemPrompt(
  value: string,
  storage: Pick<Storage, "setItem">,
): string {
  const normalized = normalizePromptOptimizerSystemPrompt(value);
  storage.setItem(PROMPT_OPTIMIZER_STORAGE_KEY, normalized);
  return normalized;
}

export function resetPromptOptimizerSystemPrompt(storage: Pick<Storage, "removeItem">): string {
  storage.removeItem(PROMPT_OPTIMIZER_STORAGE_KEY);
  return PROMPT_OPTIMIZER_SYSTEM_PROMPT;
}
