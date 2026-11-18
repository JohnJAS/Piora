// Pure helpers for the chat input's @ file autocomplete. Mirrors the pi TUI's
// behavior: @ triggers at line start or after whitespace, entries are ranked
// with the TUI's scoreEntry ladder, and completions insert "@relative/path ".

export interface AtQueryMatch {
  /** Index of the "@" character in the text */
  start: number;
  /** Text typed after the "@" (quotes stripped); may be empty */
  query: string;
  /** True when the token uses the @"..." quoted form */
  quoted: boolean;
}

export interface FileIndexEntry {
  /** Path relative to the session cwd, "/"-separated, no trailing slash */
  path: string;
  isDir: boolean;
}

/**
 * Detect an @ file token immediately before the cursor. The @ must be at the
 * start of the text or preceded by whitespace (same rule as the TUI), so
 * emails like foo@bar never trigger. Supports the in-progress quoted form
 * @"my dir/fi so drill-down into space-containing paths keeps working.
 */
export function extractAtQuery(textBeforeCursor: string): AtQueryMatch | null {
  const quoted = /(?:^|\s)@"([^"\n]*)$/.exec(textBeforeCursor);
  if (quoted) {
    return {
      start: textBeforeCursor.length - (quoted[1].length + 2),
      query: quoted[1],
      quoted: true,
    };
  }
  const plain = /(?:^|\s)@([^\s"]*)$/.exec(textBeforeCursor);
  if (plain) {
    return {
      start: textBeforeCursor.length - (plain[1].length + 1),
      query: plain[1],
      quoted: false,
    };
  }
  return null;
}

export const AT_RESULT_LIMIT = 20;
export { buildEntriesFromFiles, filterFileEntries } from "./read-runtime/file-ranking.mjs";

export interface AtInsertion {
  /** Text that replaces the @token */
  text: string;
  /** Caret position relative to the start of `text` after insertion */
  cursorOffset: number;
}

/**
 * Replacement for the @token when a suggestion is confirmed. Mirrors the
 * TUI's buildCompletionValue/applyCompletion:
 * - Files close the token: "@path " (quoted when the path contains spaces),
 *   caret after the trailing space.
 * - Directories keep the menu open for drill-down: "@dir/" with no trailing
 *   space. Quoted directories are inserted CLOSED (@"my dir/") with the caret
 *   placed before the closing quote, so both further typing and manual
 *   completion keep the token well-formed.
 */
export function buildAtInsertText(entryPath: string, isDir: boolean, forceQuotes = false): AtInsertion {
  const p = isDir ? `${entryPath}/` : entryPath;
  const needsQuotes = forceQuotes || p.includes(" ");
  if (isDir) {
    const text = needsQuotes ? `@"${p}"` : `@${p}`;
    return { text, cursorOffset: needsQuotes ? text.length - 1 : text.length };
  }
  const text = needsQuotes ? `@"${p}" ` : `@${p} `;
  return { text, cursorOffset: text.length };
}

/**
 * Closed @mention for one-shot inserts (e.g. the file explorer's @ button).
 * Unlike buildAtInsertText there is no drill-down: directories are closed
 * too, with a trailing "/" and a trailing space.
 */
export function buildAtMentionText(entryPath: string, isDir: boolean): string {
  const p = isDir ? `${entryPath}/` : entryPath;
  return p.includes(" ") ? `@"${p}" ` : `@${p} `;
}

/** Closed file @mention scoped to one logical line or an inclusive line range. */
export function buildFileLineMentionText(entryPath: string, startLine: number, endLine: number): string {
  const firstLine = Math.max(1, Math.min(startLine, endLine));
  const lastLine = Math.max(1, Math.max(startLine, endLine));
  const pathMention = entryPath.includes(" ") ? `@"${entryPath}"` : `@${entryPath}`;
  const lineSuffix = firstLine === lastLine ? `:${firstLine}` : `:${firstLine}-${lastLine}`;
  return `${pathMention}${lineSuffix} `;
}

export function buildFileAtMentionsText(entryPaths: string[]): string {
  return entryPaths.map((entryPath) => buildAtMentionText(entryPath, false)).join("");
}
