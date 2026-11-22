import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "../atomic-file.ts";
import {
  BUILTIN_SUBAGENT_PROFILES,
  MAX_CUSTOM_PROFILES_PER_SCOPE,
  parseSubagentProfileMaxTurns,
  parseSubagentProfileAliases,
  parseSubagentProfileId,
  parseSubagentProfileTools,
  parseSubagentSettings,
  readSubagentSettings,
  writeSubagentSettings,
} from "../subagent-settings.ts";
import { subagentProfilePreferenceKey, type SubagentProfile, type SubagentProfileWarning, type SubagentSettings } from "../subagent-types.ts";

export { MAX_CUSTOM_PROFILES_PER_SCOPE };

export type CustomSubagentScope = "user" | "project";

export interface CustomSubagentProfileInput {
  scope: CustomSubagentScope;
  name: string;
  previousName?: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  maxTurns?: number;
  background?: boolean;
}

const VALID_PROFILE_NAME = /^[a-zA-Z0-9\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff._-]{0,63}$/u;
const MODEL_PATTERN = /^[^/\s]+\/.+$/u;

function profileDirectory(scope: CustomSubagentScope, cwd?: string): string {
  if (scope === "user") return join(getAgentDir(), "agents");
  if (!cwd) throw new TypeError("Project scope requires an active project directory");
  return join(cwd, ".piora", "agents");
}

function isReservedName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return BUILTIN_SUBAGENT_PROFILES.some(profile => profile.name.toLowerCase() === lower);
}

function safeFileSlug(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/gu, "-").replace(/\.+$/u, "");
  if (!cleaned || cleaned === "." || cleaned === "..") throw new TypeError("Invalid subagent profile name");
  return cleaned;
}

function assertWithinDirectory(dir: string, target: string): void {
  const root = resolve(dir);
  const resolved = resolve(target);
  if (resolved === root || !resolved.startsWith(`${root}${sep}`)) {
    throw new TypeError("Profile path escapes agents directory");
  }
}

/** Always emit valid YAML 1.2 double-quoted scalars so values like `@team`, `001`, `true`, `null` round-trip verbatim. */
function formatYamlString(value: string): string {
  return JSON.stringify(value);
}

function appendYamlStringList(lines: string[], key: string, values: readonly string[]): void {
  if (values.length === 0) {
    lines.push(`${key}: []`);
    return;
  }
  lines.push(`${key}:`);
  for (const item of values) {
    lines.push(`  - ${formatYamlString(item)}`);
  }
}

export function serializeSubagentProfileMarkdown(
  input: Omit<CustomSubagentProfileInput, "scope" | "previousName"> & { id?: string; aliases?: string[] },
): string {
  const lines = ["---"];
  if (input.id) {
    lines.push(`id: ${formatYamlString(input.id)}`);
  }
  lines.push(`name: ${formatYamlString(input.name)}`);
  lines.push(`description: ${formatYamlString(input.description)}`);
  if (input.aliases && input.aliases.length > 0) {
    appendYamlStringList(lines, "aliases", input.aliases);
  }
  if (input.tools !== undefined) {
    appendYamlStringList(lines, "tools", input.tools);
  }
  if (input.disallowedTools && input.disallowedTools.length > 0) {
    appendYamlStringList(lines, "disallowedTools", input.disallowedTools);
  }
  if (input.model) {
    lines.push(`model: ${formatYamlString(input.model)}`);
  }
  if (input.maxTurns && input.maxTurns > 0) {
    lines.push("pioraLimitsVersion: 1", `maxTurns: ${input.maxTurns}`);
  }
  if (input.background) {
    lines.push("background: true");
  }
  lines.push("---", "");
  const body = input.systemPrompt.replace(/\r\n/gu, "\n").trim();
  return `${lines.join("\n")}${body}\n`;
}

export function parseCustomProfileContent(markdown: string, file: string, source: CustomSubagentScope): SubagentProfile {
  const { frontmatter: v, body } = parseFrontmatter(markdown);
  const rawName = v.name === undefined ? file.slice(0, -3) : String(v.name);
  const name = rawName.trim();
  if (!name || name.length > 200 || isReservedName(name)) {
    throw new Error(`Invalid/reserved subagent profile: ${name || file}`);
  }
  const maxTurns = parseSubagentProfileMaxTurns(v.maxTurns, v.pioraLimitsVersion, file);
  if (v.model !== undefined && (typeof v.model !== "string" || !MODEL_PATTERN.test(v.model))) {
    throw new Error(`Invalid model: ${file}`);
  }
  return {
    id: parseSubagentProfileId(v.id),
    aliases: parseSubagentProfileAliases(v.aliases),
    name,
    source,
    fileName: basename(file),
    description: String(v.description ?? name).slice(0, 1000),
    systemPrompt: body,
    tools: parseSubagentProfileTools(v.tools),
    disallowedTools: parseSubagentProfileTools(v.disallowedTools),
    model: v.model as string | undefined,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    background: v.background === true,
  };
}

function parseCustomProfileFile(path: string, file: string, source: CustomSubagentScope): SubagentProfile {
  if (statSync(path).size > 64_000) throw new Error(`Subagent profile too large: ${file}`);
  return parseCustomProfileContent(readFileSync(path, "utf8"), file, source);
}

/**
 * Fault-tolerant profile discovery shared by the settings API, extension prompt
 * builder, and SubagentRuntime: malformed custom `.md` files become warnings
 * without breaking valid built-in or custom subagents.
 */
export function listSubagentProfilesSafe(cwd?: string): { profiles: SubagentProfile[]; warnings: SubagentProfileWarning[] } {
  const profiles = new Map<string, SubagentProfile>(
    BUILTIN_SUBAGENT_PROFILES.map(profile => [profile.name, structuredClone(profile)]),
  );
  const warnings: SubagentProfileWarning[] = [];
  const scopes: Array<[string, CustomSubagentScope]> = [[join(getAgentDir(), "agents"), "user"]];
  if (cwd) scopes.push([join(cwd, ".piora", "agents"), "project"]);

  for (const [directory, scope] of scopes) {
    let files: string[];
    try {
      files = readdirSync(directory).filter(name => name.endsWith(".md")).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      warnings.push({ file: ".", scope, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (files.length > MAX_CUSTOM_PROFILES_PER_SCOPE) {
      warnings.push({ file: ".", scope, message: `Too many subagent profiles (limit: ${MAX_CUSTOM_PROFILES_PER_SCOPE})` });
      files = files.slice(0, MAX_CUSTOM_PROFILES_PER_SCOPE);
    }
    for (const file of files) {
      try {
        const profile = parseCustomProfileFile(join(directory, file), file, scope);
        profiles.set(profile.name, profile);
      } catch (error) {
        warnings.push({ file, scope, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { profiles: [...profiles.values()], warnings };
}

function normalizeToolsList(values: unknown, label: string, preserveEmptyArray: boolean): string[] | undefined {
  if (values === undefined || values === null) return undefined;
  const raw = typeof values === "string"
    ? values.split(",").map(item => item.trim()).filter(Boolean)
    : Array.isArray(values)
      ? values.map(item => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
      : null;
  if (!raw) throw new TypeError(`Invalid ${label}`);
  if (Array.isArray(values) && values.some(item => typeof item !== "string")) {
    throw new TypeError(`Invalid ${label}`);
  }
  const unique = [...new Set(raw)];
  if (unique.length > 64 || unique.some(item => item.length > 80 || /[\r\n,]/u.test(item))) {
    throw new TypeError(`Invalid ${label}`);
  }
  if (unique.length === 0) return preserveEmptyArray && Array.isArray(values) ? [] : undefined;
  return unique;
}

export function validateCustomSubagentProfileInput(raw: unknown): CustomSubagentProfileInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Invalid subagent profile payload");
  const data = raw as Record<string, unknown>;
  const scope = data.scope;
  if (scope !== "user" && scope !== "project") throw new TypeError("Scope must be user or project");
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name || !VALID_PROFILE_NAME.test(name)) {
    throw new TypeError("Profile name must start with a letter, digit, or CJK character and contain only letters, digits, ., _, or - (max 64 chars)");
  }
  if (isReservedName(name)) throw new TypeError(`"${name}" is a built-in subagent name and cannot be overridden`);
  const previousName = typeof data.previousName === "string" && data.previousName.trim() ? data.previousName.trim() : undefined;
  if (previousName && isReservedName(previousName)) throw new TypeError("Built-in subagents cannot be edited");
  const description = typeof data.description === "string" ? data.description.replace(/[\r\n]+/gu, " ").trim() : "";
  if (!description || description.length > 500) throw new TypeError("Provide a profile description (1-500 characters)");
  const systemPrompt = typeof data.systemPrompt === "string" ? data.systemPrompt.trim() : "";
  if (!systemPrompt || systemPrompt.length > 32_000) throw new TypeError("Provide a system prompt (1-32000 characters)");
  let maxTurns: number | undefined;
  if (data.maxTurns !== undefined && data.maxTurns !== null && data.maxTurns !== "") {
    const parsedMaxTurns = typeof data.maxTurns === "number"
      ? data.maxTurns
      : typeof data.maxTurns === "string" && data.maxTurns.trim() !== ""
        ? Number(data.maxTurns.trim())
        : Number.NaN;
    if (!Number.isSafeInteger(parsedMaxTurns) || parsedMaxTurns < 0 || parsedMaxTurns > 100) {
      throw new TypeError("maxTurns must be 0 (unlimited) or an integer between 1 and 100");
    }
    maxTurns = parsedMaxTurns === 0 ? undefined : parsedMaxTurns;
  }
  const model = typeof data.model === "string" && data.model.trim() ? data.model.trim() : undefined;
  if (model && (model.length > 256 || !MODEL_PATTERN.test(model))) throw new TypeError("Model must use provider/modelId format");
  const background = data.background === true;
  // Preserve explicit empty `tools: []` (zero tools) vs `undefined` (inherit all parent tools).
  const tools = normalizeToolsList(data.tools, "tools", true);
  const disallowedTools = normalizeToolsList(data.disallowedTools, "disallowedTools", false);
  return { scope, name, previousName, description, systemPrompt, tools, disallowedTools, model, maxTurns, background };
}

function findProfileFileByName(directory: string, targetName: string): { path: string; profile: SubagentProfile } | undefined {
  let files: string[];
  try {
    files = readdirSync(directory).filter(name => name.endsWith(".md"));
  } catch {
    return undefined;
  }
  for (const file of files) {
    const full = join(directory, file);
    try {
      const profile = parseCustomProfileFile(full, file, "user");
      if (profile.name === targetName) return { path: full, profile };
    } catch { /* Ignore unreadable files while locating target. */ }
  }
  return undefined;
}

export interface PreparedProfileSave {
  input: CustomSubagentProfileInput;
  directory: string;
  targetFile: string;
  markdown: string;
  stableId: string;
  prior?: SubagentProfile;
  previousFilePath?: string;
  previousTargetContent?: string;
  verified: SubagentProfile;
}

export function prepareCustomSubagentProfileSave(raw: unknown, cwd?: string): PreparedProfileSave {
  const input = validateCustomSubagentProfileInput(raw);
  const directory = profileDirectory(input.scope, cwd);

  const existingByName = findProfileFileByName(directory, input.name);
  const existingByPrevious = input.previousName
    ? findProfileFileByName(directory, input.previousName)
    : undefined;

  if (input.previousName && !existingByPrevious) {
    throw new TypeError(`Subagent profile "${input.previousName}" no longer exists in this scope`);
  }
  if (!input.previousName && existingByName) {
    throw new TypeError(`A subagent profile named "${input.name}" already exists in this scope`);
  }
  if (input.previousName && input.previousName !== input.name && existingByName) {
    throw new TypeError(`A subagent profile named "${input.name}" already exists in this scope`);
  }

  // Enforce the same per-scope capacity limit at create time so newly saved
  // profiles never disappear from discovery or fail runtime lookup later.
  if (!existingByPrevious && !existingByName) {
    let existingCount = 0;
    try {
      existingCount = readdirSync(directory).filter(name => name.endsWith(".md")).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existingCount >= MAX_CUSTOM_PROFILES_PER_SCOPE) {
      throw new TypeError(`Too many subagent profiles in this scope (limit: ${MAX_CUSTOM_PROFILES_PER_SCOPE}). Delete an unused profile before creating a new one.`);
    }
  }

  const targetFile = existingByName?.path ?? join(directory, `${safeFileSlug(input.name)}.md`);
  assertWithinDirectory(directory, targetFile);
  if (!existingByName && existsSync(targetFile) && targetFile !== existingByPrevious?.path) {
    throw new TypeError(`Profile file "${basename(targetFile)}" already exists`);
  }

  const prior = existingByPrevious?.profile ?? existingByName?.profile;
  const stableId = prior?.id ?? `prof_${randomUUID()}`;
  const aliasSet = new Set<string>(prior?.aliases ?? []);
  if (input.previousName && input.previousName !== input.name) {
    aliasSet.add(input.previousName);
  }
  aliasSet.delete(input.name);
  const aliases = [...aliasSet].slice(-32);

  const markdown = serializeSubagentProfileMarkdown({
    ...input,
    id: stableId,
    aliases: aliases.length > 0 ? aliases : undefined,
  });
  if (Buffer.byteLength(markdown, "utf8") > 64_000) {
    throw new TypeError("Profile file exceeds the 64 KB limit");
  }

  // Validate the serialized candidate completely in memory BEFORE mutating disk.
  const verified = parseCustomProfileContent(markdown, basename(targetFile), input.scope);
  if (verified.name !== input.name || verified.description !== input.description) {
    throw new TypeError("Serialized profile failed round-trip validation");
  }

  const previousTargetContent = existsSync(targetFile) ? readFileSync(targetFile, "utf8") : undefined;

  return {
    input,
    directory,
    targetFile,
    markdown,
    stableId,
    prior,
    previousFilePath: existingByPrevious?.path,
    previousTargetContent,
    verified,
  };
}

export function commitCustomSubagentProfileSave(prepared: PreparedProfileSave, options?: { keepPrevious?: boolean }): void {
  mkdirSync(prepared.directory, { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(prepared.targetFile, prepared.markdown);
  if (!options?.keepPrevious && prepared.previousFilePath && resolve(prepared.previousFilePath) !== resolve(prepared.targetFile)) {
    assertWithinDirectory(prepared.directory, prepared.previousFilePath);
    try { unlinkSync(prepared.previousFilePath); } catch { /* Best-effort cleanup of renamed file. */ }
  }
}

export function finalizeCustomSubagentProfileSave(prepared: PreparedProfileSave): SubagentProfile {
  if (prepared.previousFilePath && resolve(prepared.previousFilePath) !== resolve(prepared.targetFile)) {
    assertWithinDirectory(prepared.directory, prepared.previousFilePath);
    try { unlinkSync(prepared.previousFilePath); } catch { /* Best-effort cleanup of renamed file. */ }
  }
  return parseCustomProfileFile(prepared.targetFile, basename(prepared.targetFile), prepared.input.scope);
}

export function rollbackCustomSubagentProfileSave(prepared: PreparedProfileSave): void {
  if (prepared.previousTargetContent !== undefined) {
    writePrivateFileAtomicSync(prepared.targetFile, prepared.previousTargetContent);
    return;
  }
  if (existsSync(prepared.targetFile)) {
    assertWithinDirectory(prepared.directory, prepared.targetFile);
    unlinkSync(prepared.targetFile);
  }
}

export function saveCustomSubagentProfile(raw: unknown, cwd?: string): SubagentProfile {
  const prepared = prepareCustomSubagentProfileSave(raw, cwd);
  commitCustomSubagentProfileSave(prepared);
  return finalizeCustomSubagentProfileSave(prepared);
}

export interface SubagentSettingsStoreDeps {
  readSettings?: () => SubagentSettings;
  writeSettings?: (value: unknown) => SubagentSettings;
}

export function saveSubagentProfileWithSettings(
  raw: unknown,
  cwd?: string,
  deps?: SubagentSettingsStoreDeps,
): { profile: SubagentProfile; settings: SubagentSettings } {
  const prepared = prepareCustomSubagentProfileSave(raw, cwd);
  const readSettingsFn = deps?.readSettings ?? readSubagentSettings;
  const writeSettingsFn = deps?.writeSettings ?? writeSubagentSettings;
  let settings = readSettingsFn();

  // Only migrate preferences once when a legacy hand-written profile without
  // an ID first receives one. Profiles with an ID already use `id:<uuid>`,
  // so renames never touch another project's or profile's preferences.
  let nextSettingsCandidate: SubagentSettings | undefined;
  if (prepared.prior && !prepared.prior.id) {
    const legacyKey = prepared.prior.name;
    const targetKey = subagentProfilePreferenceKey(prepared.verified);
    const hasDisabled = settings.disabledProfiles.includes(legacyKey) && !settings.disabledProfiles.includes(targetKey);
    const hasOverride = Object.hasOwn(settings.modelOverrides, legacyKey) && !Object.hasOwn(settings.modelOverrides, targetKey);
    if (hasDisabled || hasOverride) {
      const nextDisabled = hasDisabled ? [...settings.disabledProfiles, targetKey] : settings.disabledProfiles;
      const nextOverrides = hasOverride
        ? { ...settings.modelOverrides, [targetKey]: settings.modelOverrides[legacyKey] }
        : settings.modelOverrides;
      nextSettingsCandidate = parseSubagentSettings({
        ...settings,
        disabledProfiles: nextDisabled,
        modelOverrides: nextOverrides,
      });
    }
  }

  commitCustomSubagentProfileSave(prepared, { keepPrevious: true });
  if (nextSettingsCandidate) {
    try {
      settings = writeSettingsFn(nextSettingsCandidate);
    } catch (error) {
      rollbackCustomSubagentProfileSave(prepared);
      throw error;
    }
  }
  const profile = finalizeCustomSubagentProfileSave(prepared);
  return { profile, settings };
}

export function deleteCustomSubagentProfile(name: string, scope: CustomSubagentScope, cwd?: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || isReservedName(trimmed)) throw new TypeError("Built-in subagents cannot be deleted");
  const directory = profileDirectory(scope, cwd);
  const found = findProfileFileByName(directory, trimmed);
  if (!found) return false;
  assertWithinDirectory(directory, found.path);
  unlinkSync(found.path);
  return true;
}

export function deleteSubagentProfileWithSettings(
  name: string,
  scope: CustomSubagentScope,
  cwd?: string,
  deps?: SubagentSettingsStoreDeps,
): { deleted: boolean; settings: SubagentSettings } {
  const trimmed = name.trim();
  if (!trimmed || isReservedName(trimmed)) throw new TypeError("Built-in subagents cannot be deleted");
  const directory = profileDirectory(scope, cwd);
  const found = findProfileFileByName(directory, trimmed);
  const readSettingsFn = deps?.readSettings ?? readSubagentSettings;
  const writeSettingsFn = deps?.writeSettings ?? writeSubagentSettings;
  let settings = readSettingsFn();
  if (!found) return { deleted: false, settings };

  const backupContent = readFileSync(found.path, "utf8");
  let nextSettingsCandidate: SubagentSettings | undefined;
  if (found.profile.id) {
    const idKey = `id:${found.profile.id}`;
    const hasDisabled = settings.disabledProfiles.includes(idKey);
    const hasOverride = Object.hasOwn(settings.modelOverrides, idKey);
    if (hasDisabled || hasOverride) {
      const nextOverrides = { ...settings.modelOverrides };
      delete nextOverrides[idKey];
      nextSettingsCandidate = parseSubagentSettings({
        ...settings,
        disabledProfiles: hasDisabled ? settings.disabledProfiles.filter(item => item !== idKey) : settings.disabledProfiles,
        modelOverrides: nextOverrides,
      });
    }
  }

  assertWithinDirectory(directory, found.path);
  unlinkSync(found.path);
  if (nextSettingsCandidate) {
    try {
      settings = writeSettingsFn(nextSettingsCandidate);
    } catch (error) {
      writePrivateFileAtomicSync(found.path, backupContent);
      throw error;
    }
  }
  return { deleted: true, settings };
}
