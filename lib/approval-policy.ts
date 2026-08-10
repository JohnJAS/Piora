export type PermissionTier = "read-only" | "auto-edit" | "full-access";
export type ApprovalDecision = "allow" | "ask" | "deny";

export interface DangerousCommandMatch {
  pattern: string;
  reason: string;
}

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const AUTO_EDIT_TOOLS = new Set([...READ_ONLY_TOOLS, "edit", "write"]);

function normalizeCommand(command: string): string {
  return command
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/''|""/g, "")
    .replace(/["']/g, "")
    .replace(/\\\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DANGEROUS_COMMANDS: Array<{ pattern: string; reason: string; test: RegExp }> = [
  { pattern: "rm -rf", reason: "Recursively forces file deletion", test: /(?:^|[;&|`])\s*rm\s+-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)[a-z]*\b/i },
  { pattern: "del /s", reason: "Recursively deletes Windows files", test: /(?:^|[;&|`])\s*(?:del|erase)\s+[^;&|]*\/s\b/i },
  { pattern: "format", reason: "Formats a disk or volume", test: /(?:^|[;&|`])\s*format(?:\.com)?\s+/i },
  { pattern: "mkfs", reason: "Creates a filesystem", test: /(?:^|[;&|`])\s*mkfs(?:\.[a-z0-9_-]+)?\b/i },
  { pattern: "dd if=", reason: "Performs a raw block copy", test: /(?:^|[;&|`])\s*dd\s+[^;&|]*\bif\s*=/i },
  { pattern: "remote script pipe", reason: "Downloads and executes a remote script", test: /\b(?:curl|wget)\b[^\n]*\|\s*(?:sh|bash|zsh|fish|pwsh|powershell)\b/i },
  { pattern: "git push --force", reason: "Force-pushes remote Git history", test: /\bgit\s+push\b[^;&|]*(?:--force(?:-with-lease)?|-f)\b/i },
  { pattern: "git reset --hard", reason: "Discards Git working tree changes", test: /\bgit\s+reset\b[^;&|]*--hard\b/i },
  { pattern: "npm publish", reason: "Publishes a package externally", test: /\b(?:npm|pnpm|yarn)\s+publish\b/i },
  { pattern: "docker system prune", reason: "Deletes Docker system resources", test: /\bdocker\s+system\s+prune\b/i },
  { pattern: "write ~/.ssh", reason: "Writes SSH credentials or configuration", test: /(?:>|tee\s+|copy\s+|move\s+)[^;&|]*(?:~|\$home|%userprofile%)[\\/]\.ssh\b/i },
  { pattern: "write system directory", reason: "Writes to an operating-system directory", test: /(?:>|tee\s+|copy\s+|move\s+)[^;&|]*(?:\/etc\/|\/usr\/(?:bin|sbin)\/|[a-z]:[\\/]windows[\\/]|[a-z]:[\\/]program files[\\/])/i },
];

export function matchDangerousCommand(command: string): DangerousCommandMatch | null {
  const normalized = normalizeCommand(command);
  for (const candidate of DANGEROUS_COMMANDS) {
    if (candidate.test.test(normalized)) return { pattern: candidate.pattern, reason: candidate.reason };
  }
  return null;
}

function commandFromInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const value = (input as Record<string, unknown>).command;
  return typeof value === "string" ? value : "";
}

export function decideApproval(toolName: string, input: unknown, tier: PermissionTier): ApprovalDecision {
  if (tier === "full-access") return "allow";
  if (tier === "read-only") return READ_ONLY_TOOLS.has(toolName) ? "allow" : "deny";
  if (toolName === "bash") return matchDangerousCommand(commandFromInput(input)) ? "ask" : "allow";
  if (AUTO_EDIT_TOOLS.has(toolName)) return "allow";
  return "ask";
}

export function describeApproval(toolName: string, input: unknown): { summary: string; reason: string } {
  if (toolName === "bash") {
    const command = commandFromInput(input);
    const dangerous = matchDangerousCommand(command);
    return { summary: command || "Shell command", reason: dangerous?.reason ?? "This command requires confirmation." };
  }
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const target = [record.path, record.file_path, record.filename].find((value) => typeof value === "string");
  return { summary: `${toolName}${target ? ` · ${target}` : ""}`, reason: "This extension tool requires confirmation." };
}
