export const COMMAND_HISTORY_SUGGESTION_LIMIT = 8;

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function scoreCommand(command: string, query: string): number | null {
  const normalizedCommand = normalize(command);
  if (!normalizedCommand || !query) return null;
  if (normalizedCommand === query) return 0;
  if (normalizedCommand.startsWith(query)) return 1;
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.length > 1 && terms.every((term) => normalizedCommand.includes(term))) return 2;
  return normalizedCommand.includes(query) ? 3 : null;
}

/** Rank matching commands while preserving recency inside each match tier. */
export function filterCommandHistory(
  history: readonly string[],
  query: string,
  limit = COMMAND_HISTORY_SUGGESTION_LIMIT,
): string[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery || limit <= 0) return [];

  return history
    .map((command, recency) => ({ command, recency, score: scoreCommand(command, normalizedQuery) }))
    .filter((candidate): candidate is { command: string; recency: number; score: number } => candidate.score !== null)
    .sort((first, second) => first.score - second.score || first.recency - second.recency)
    .slice(0, limit)
    .map(({ command }) => command);
}
