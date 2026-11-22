import type { WorkflowMode } from "../workflow-types";

export interface InlineWorkflowCommandMatch {
  kind: "plan" | "goal";
  rest: string;
}

/**
 * Parses leading `/plan` or `/goal` composer triggers (with optional inline body).
 * Returns null if the text does not start with a Plan/Goal slash trigger.
 */
export function parseWorkflowSlashTrigger(text: string): InlineWorkflowCommandMatch | null {
  const trimmedStart = text.trimStart();
  const match = trimmedStart.match(/^\/(plan|go+al)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const token = match[1].toLowerCase();
  const kind: "plan" | "goal" = token === "plan" ? "plan" : "goal";
  return { kind, rest: (match[2] ?? "").trim() };
}

/**
 * Matches `@plan` or `@goal` (including fuzzy `@gooal` / prefix `@pl` / `@go`)
 * against the active mention query inside the composer.
 */
export function matchesWorkflowMentionQuery(query: string, kind: "plan" | "goal"): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (kind === "plan") {
    return "plan".startsWith(normalized) || normalized === "plan";
  }
  return "goal".startsWith(normalized) || /^go+al?$/.test(normalized);
}

/**
 * Matches `/plan` or `/goal` against the slash menu query (without leading `/`).
 */
export function matchesWorkflowSlashQuery(query: string, kind: "plan" | "goal"): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (kind === "plan") return "plan".startsWith(normalized);
  return "goal".startsWith(normalized) || /^go+al?$/.test(normalized);
}

/**
 * Codex-aligned Backspace-at-start mode exit check:
 * - In Plan mode: pressing Backspace with collapsed cursor at index 0 exits Plan mode.
 * - In Goal drafting mode: pressing Backspace when input is empty (or cursor at 0) exits Goal drafting.
 */
export function shouldBackspaceExitWorkflowMode(params: {
  mode: WorkflowMode;
  goalDrafting: boolean;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}): "plan" | "goal" | null {
  if (params.key !== "Backspace" || params.isComposing) return null;
  if (params.ctrlKey || params.metaKey || params.altKey || params.shiftKey) return null;
  if (params.selectionStart !== 0 || params.selectionEnd !== 0) return null;
  if (params.mode === "plan") return "plan";
  if (params.goalDrafting && params.value.length === 0) return "goal";
  return null;
}

/**
 * Strips an inline `@plan` or `@goal` mention token at the given cursor position.
 */
export function removeMentionToken(
  text: string,
  mentionStart: number,
  cursorPos: number,
): { nextText: string; nextCursor: number } {
  const before = text.slice(0, mentionStart);
  const after = text.slice(cursorPos);
  const needsTrim = before.endsWith(" ") && after.startsWith(" ");
  const nextText = `${before}${needsTrim ? after.slice(1) : after}`;
  return { nextText, nextCursor: before.length };
}
