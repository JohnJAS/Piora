const MAX_ACTIVITY_LENGTH = 140;

function compactText(value: string, maxLength = 96): string {
  const singleLine = value.replace(/\s+/gu, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, Math.max(1, maxLength - 1))}…`;
}

function readStringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function basenameOrTail(filePath: string): string {
  const normalized = filePath.replace(/\\/gu, "/").replace(/\/+$/u, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `${parts.at(-2)}/${parts.at(-1)}`;
}

/**
 * Produces a concise, bounded, human-readable summary of a tool invocation
 * suitable for live activity feeds and read-only subagent transcripts.
 */
export function summarizeToolActivity(toolName: string, args: unknown): string | undefined {
  const cleanName = typeof toolName === "string" ? toolName.trim().slice(0, 64) : "";
  if (!cleanName) return undefined;
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const input = args as Record<string, unknown>;
  const lower = cleanName.toLowerCase();

  if (lower === "read" || lower === "write" || lower === "edit") {
    const target = readStringField(input, ["path", "filePath", "file_path", "target"]);
    if (target) return compactText(basenameOrTail(target), MAX_ACTIVITY_LENGTH);
  }

  if (lower === "grep" || lower === "search" || lower === "find" || lower === "ls") {
    const pattern = readStringField(input, ["pattern", "query", "glob", "name"]);
    const target = readStringField(input, ["path", "dir", "directory", "cwd"]);
    if (pattern && target) return compactText(`"${compactText(pattern, 48)}" · ${basenameOrTail(target)}`, MAX_ACTIVITY_LENGTH);
    if (pattern) return compactText(`"${compactText(pattern, 72)}"`, MAX_ACTIVITY_LENGTH);
    if (target) return compactText(basenameOrTail(target), MAX_ACTIVITY_LENGTH);
  }

  if (lower === "bash" || lower === "powershell" || lower === "shell" || lower === "command") {
    const command = readStringField(input, ["command", "cmd", "script"]);
    if (command) {
      const firstLine = command.split(/\r?\n/u).find(line => line.trim()) ?? command;
      return compactText(firstLine, MAX_ACTIVITY_LENGTH);
    }
  }

  const generic = readStringField(input, ["url", "path", "filePath", "query", "pattern", "command", "action", "description", "title", "target"]);
  if (generic) return compactText(generic, MAX_ACTIVITY_LENGTH);

  return undefined;
}

export function formatLiveToolActivity(toolName: string, args: unknown): string {
  const cleanName = toolName.trim().slice(0, 64);
  const summary = summarizeToolActivity(cleanName, args);
  if (!summary) return cleanName;
  return compactText(`${cleanName} · ${summary}`, MAX_ACTIVITY_LENGTH);
}
