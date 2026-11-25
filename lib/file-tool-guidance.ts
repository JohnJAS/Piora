const FILE_TOOL_NAMES = ["read", "ls", "find", "grep", "edit", "write"] as const;

/** Only advertise tools that are active for this prompt. This is guidance, not a shell gate. */
export function fileToolGuidance(selectedTools: readonly string[]): string {
  const active = new Set(selectedTools);
  const available = FILE_TOOL_NAMES.filter((name) => active.has(name));
  if (!available.length) return "";

  const rules: string[] = [];
  if (active.has("read")) rules.push("`read` inspects local files with path and offset/limit (continue large files with offset/limit).");
  if (active.has("ls")) rules.push("`ls` lists a local directory.");
  if (active.has("find")) rules.push("`find` finds local files by name or glob pattern.");
  if (active.has("grep")) rules.push("`grep` searches local file contents.");
  if (active.has("edit")) rules.push("`edit` applies targeted edits to local files.");
  if (active.has("write")) rules.push("`write` creates or replaces local files.");
  rules.push("These local file tools work alongside shell tools (builds, tests, Git, pipelines, or shell commands). Follow explicit user tool choices, do not route remote SSH paths through local file tools, and retain real tool identities.");
  return `<piora_file_tools>\n${rules.join("\n")}\n</piora_file_tools>`;
}

export function compactFileToolGuidance(selectedTools: readonly string[]): string {
  const active = new Set(selectedTools);
  const available = FILE_TOOL_NAMES.filter((name) => active.has(name));
  if (!available.length) return "";
  return `Dedicated local file tools (${available.join(", ")}) are available alongside shell tools; follow explicit user tool choices and keep remote SSH paths on ssh.`;
}
