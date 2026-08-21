import {
  SESSION_TITLE_PROMPT,
  normalizeSessionTitlePrompt,
} from "./session-title-prompt";

export { SESSION_TITLE_PROMPT } from "./session-title-prompt";

export const SESSION_TITLE_PROMPT_STORAGE_KEY = "piora-session-title-prompt-v1";

export function readSessionTitlePrompt(storage?: Pick<Storage, "getItem">): string {
  if (!storage) return SESSION_TITLE_PROMPT;
  try {
    return normalizeSessionTitlePrompt(storage.getItem(SESSION_TITLE_PROMPT_STORAGE_KEY));
  } catch {
    return SESSION_TITLE_PROMPT;
  }
}

export function writeSessionTitlePrompt(
  value: string,
  storage: Pick<Storage, "setItem">,
): string {
  const normalized = normalizeSessionTitlePrompt(value);
  storage.setItem(SESSION_TITLE_PROMPT_STORAGE_KEY, normalized);
  return normalized;
}

export function resetSessionTitlePrompt(storage: Pick<Storage, "removeItem">): string {
  storage.removeItem(SESSION_TITLE_PROMPT_STORAGE_KEY);
  return SESSION_TITLE_PROMPT;
}
