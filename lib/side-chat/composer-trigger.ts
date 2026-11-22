export type ParsedSideSlashTrigger =
  | { matched: false }
  | { matched: true; initialPrompt: string };

/**
 * Parse `/side` and `/side <question>` triggers matching Codex's slash behavior.
 * Only triggers when `/side` is the standalone command token at message start.
 */
export function parseSideSlashTrigger(input: string): ParsedSideSlashTrigger {
  const trimmedStart = input.trimStart();
  if (!trimmedStart.startsWith("/side")) return { matched: false };
  const rest = trimmedStart.slice("/side".length);
  if (rest.length > 0 && !/^\s/.test(rest)) return { matched: false };
  return { matched: true, initialPrompt: rest.trim() };
}

/** Determine whether the composer's inline slash menu should include `/side`. */
export function matchesSideSlashQuery(slashQuery: string | null): boolean {
  if (slashQuery === null) return false;
  const clean = slashQuery.trim().toLowerCase();
  if (!clean) return true;
  return "side".startsWith(clean);
}

/** Build a quote prefix when launching a side chat from selected transcript text. */
export function formatQuotedSideSelection(selectedText: string): string {
  const trimmed = selectedText.trim();
  if (!trimmed) return "";
  const quoted = trimmed
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return `${quoted}\n\n`;
}

const DEFAULT_PLACEHOLDER_PATTERNS = [
  /^Side chat(?:\s+\d+)?$/i,
  /^侧边对话(?:\s*\d+)?$/,
];

/** True when a side chat title is still an auto-generated placeholder name. */
export function isDefaultSideChatTitle(title: string | undefined | null): boolean {
  if (!title || !title.trim()) return true;
  const trimmed = title.trim();
  return DEFAULT_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Derive a concise auto-title from the side chat's first direct user prompt. */
export function deriveSideChatAutoTitle(message: string, hasImages = false): string {
  const firstLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  const normalized = firstLine.replace(/\s+/g, " ").trim();
  if (!normalized) return hasImages ? "[Image]" : "";
  const chars = Array.from(normalized);
  if (chars.length <= 48) return normalized;
  return `${chars.slice(0, 47).join("").trimEnd()}…`;
}
