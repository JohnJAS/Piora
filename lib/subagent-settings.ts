import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file.ts";
import type { SubagentProfile, SubagentSettings } from "./subagent-types.ts";

export const MAX_CUSTOM_PROFILES_PER_SCOPE = 100;

export const DEFAULT_SUBAGENT_SETTINGS: SubagentSettings = {
  enabled: false, maxConcurrency: 4, timeoutSeconds: 0, maxTokens: 0,
  maxResultChars: 8_000, disabledProfiles: [], modelOverrides: {},
};

const LIMIT_BOUNDS = [
  ["maxConcurrency", 1, 16],
  ["timeoutSeconds", 0, 3600],
  ["maxTokens", 0, 10_000_000],
  ["maxResultChars", 1, 100_000],
] as const;

export function subagentSettingsPath(): string { return join(getAgentDir(), "piora", "subagents.json"); }

export function parseSubagentSettings(value: unknown): SubagentSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid subagent settings");
  const v = value as Partial<SubagentSettings>;
  if (Object.keys(v).some(key => !(key in DEFAULT_SUBAGENT_SETTINGS)) || typeof v.enabled !== "boolean") {
    throw new TypeError("Invalid subagent settings fields");
  }
  const limits: Record<string, number> = {};
  for (const [key, min, max] of LIMIT_BOUNDS) {
    // Support upgrading from beta.26 three-field settings where limit fields are absent.
    const raw = v[key];
    const resolved = raw === undefined ? DEFAULT_SUBAGENT_SETTINGS[key] : raw;
    if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new TypeError(`Invalid ${key}`);
    limits[key] = resolved;
  }
  if (!Array.isArray(v.disabledProfiles) || v.disabledProfiles.length > 200 || v.disabledProfiles.some(name => typeof name !== "string" || !name || name.length > 200)) {
    throw new TypeError("Invalid disabled profiles");
  }
  if (!v.modelOverrides || typeof v.modelOverrides !== "object" || Array.isArray(v.modelOverrides) || Object.keys(v.modelOverrides).length > 200
    || Object.entries(v.modelOverrides).some(([name, model]) => !name || name.length > 200 || typeof model !== "string" || model.length > 256 || (model !== "" && !/^[^/\s]+\/.+$/u.test(model)))) {
    throw new TypeError("Models use provider/modelId");
  }
  return {
    enabled: v.enabled,
    maxConcurrency: limits.maxConcurrency,
    timeoutSeconds: limits.timeoutSeconds,
    maxTokens: limits.maxTokens,
    maxResultChars: limits.maxResultChars,
    disabledProfiles: [...new Set(v.disabledProfiles)],
    modelOverrides: { ...v.modelOverrides },
  };
}

export function readSubagentSettings(): SubagentSettings {
  try { return parseSubagentSettings(JSON.parse(readFileSync(subagentSettingsPath(), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(DEFAULT_SUBAGENT_SETTINGS); throw error; }
}

export function writeSubagentSettings(value: unknown): SubagentSettings {
  const settings = parseSubagentSettings(value), path = subagentSettingsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(path, JSON.stringify(settings));
  return settings;
}

export const BUILTIN_SUBAGENT_PROFILES: readonly SubagentProfile[] = [
  { name: "general-purpose", description: "Independent research, implementation and review.", source: "built-in",
    systemPrompt: "Complete the delegated task independently. You have a separate context, share the parent's workspace, and receive only the supplied task, not its conversation. Respect project instructions. Coordinate file ownership and avoid overwriting unrelated changes. Return a concise result with evidence, file paths, checks actually run, and remaining limitations. Never claim checks you did not run." },
  { name: "Explore", description: "Read-only workspace exploration and code search.", source: "built-in",
    tools: ["read", "grep", "find", "ls"], systemPrompt: "Explore the workspace using read-only tools. Do not change files or execute commands. Return concise findings with file paths and evidence. Your context is isolated from the parent; use the supplied task." },
];

export function parseSubagentMaxTurns(value: unknown, file: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value.trim())
      : Number.NaN;
  if (parsed === 0) return undefined;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error(`Invalid maxTurns: ${file}`);
  }
  return parsed;
}

export function parseSubagentProfileTools(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const list = typeof value === "string" ? value.split(",").map(item => item.trim()).filter(Boolean) : value;
  if (!Array.isArray(list) || list.some(item => typeof item !== "string" || item.length > 200)) throw new TypeError("Profile tools must be a list");
  return list;
}

export function parseSubagentProfileAliases(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const list = typeof value === "string" ? value.split(",").map(item => item.trim()).filter(Boolean) : value;
  if (!Array.isArray(list) || list.length > 32 || list.some(item => typeof item !== "string" || !item.trim() || item.length > 200)) {
    throw new TypeError("Profile aliases must be a list of names");
  }
  const unique = [...new Set(list.map(item => item.trim()))];
  return unique.length > 0 ? unique : undefined;
}

export function parseSubagentProfileId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) {
    throw new TypeError("Invalid profile id");
  }
  return value;
}

/** Project profiles override user profiles by exact name; built-in identities cannot be impersonated. */
export function listSubagentProfiles(cwd: string): SubagentProfile[] {
  const profiles = new Map(BUILTIN_SUBAGENT_PROFILES.map(profile => [profile.name, structuredClone(profile)]));
  for (const [directory, source] of [[join(getAgentDir(), "agents"), "user"], [join(cwd, ".piora", "agents"), "project"]] as const) {
    let files: string[];
    try { files = readdirSync(directory).filter(name => name.endsWith(".md")).sort(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (files.length > MAX_CUSTOM_PROFILES_PER_SCOPE) throw new Error("Too many subagent profiles");
    for (const file of files) {
      const path = join(directory, file);
      if (statSync(path).size > 64_000) throw new Error(`Subagent profile too large: ${file}`);
      const { frontmatter: v, body } = parseFrontmatter(readFileSync(path, "utf8"));
      const name = String(v.name ?? file.slice(0, -3));
      if (!name.trim() || name.length > 200 || BUILTIN_SUBAGENT_PROFILES.some(profile => profile.name.toLowerCase() === name.toLowerCase())) throw new Error(`Invalid/reserved subagent profile: ${name}`);
      const maxTurns = parseSubagentMaxTurns(v.maxTurns, file);
      if (v.model !== undefined && (typeof v.model !== "string" || !/^[^/\s]+\/.+$/u.test(v.model))) throw new Error(`Invalid model: ${file}`);
      profiles.set(name, {
        id: parseSubagentProfileId(v.id),
        aliases: parseSubagentProfileAliases(v.aliases),
        name,
        source,
        fileName: file,
        description: String(v.description ?? name).slice(0, 1000),
        systemPrompt: body,
        tools: parseSubagentProfileTools(v.tools),
        disallowedTools: parseSubagentProfileTools(v.disallowedTools),
        model: v.model as string | undefined,
        ...(maxTurns !== undefined ? { maxTurns } : {}),
        background: v.background === true,
      });
    }
  }
  return [...profiles.values()];
}
