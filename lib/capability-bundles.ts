import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execPath } from "node:process";
import { promisify } from "node:util";

import {
  DefaultPackageManager,
  getAgentDir,
  SettingsManager,
  type PackageSource,
} from "@earendil-works/pi-coding-agent";
import JSZip from "jszip";

import packageMetadata from "@/package.json";
import {
  resolveExtensionLoadPlan,
  setExtensionEnabled,
} from "@/lib/extension-config";
import { invalidateServicesCache } from "@/lib/rpc-manager";
import { runNpx } from "@/lib/npx";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";

const BUNDLE_FORMAT = "piora-capability-bundle";
const BUNDLE_VERSION = 1;
export const CAPABILITY_BUNDLE_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_PLUGINS = 200;
const MAX_SKILLS = 500;
const MAX_STATES = 1_000;
const execFileAsync = promisify(execFile);

type BundleScope = "global" | "project";

interface BundlePackageFilters {
  autoload?: boolean;
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

interface BundlePlugin {
  id: string;
  scope: BundleScope;
  label: string;
  source?: string;
  portablePath?: string;
  filters?: BundlePackageFilters;
}

interface BundleSkill {
  package: string;
  scope: BundleScope;
  disableModelInvocation: boolean;
}

type BundleExtensionState =
  | { target: "builtin"; id: string; enabled: boolean }
  | { target: "plugin"; pluginId: string; relativePath: string; enabled: boolean };

interface BundleSkillState {
  pluginId: string;
  relativePath: string;
  disableModelInvocation: boolean;
}

export interface CapabilityBundleManifest {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  id: string;
  name: string;
  createdAt: string;
  createdBy: { app: "Piora"; version: string; platform: NodeJS.Platform };
  security: { secretsIncluded: false };
  plugins: BundlePlugin[];
  skills: BundleSkill[];
  extensionStates: BundleExtensionState[];
  skillStates: BundleSkillState[];
  warnings: string[];
}

export interface CapabilityBundleImportResult {
  success: true;
  name: string;
  summary: {
    pluginsInstalled: number;
    skillsInstalled: number;
    extensionStatesApplied: number;
    skillStatesApplied: number;
  };
  warnings: string[];
  reloadRequired: true;
}

export class CapabilityBundleError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
    this.name = "CapabilityBundleError";
  }
}

interface SizedZipObject extends JSZip.JSZipObject {
  _data?: { uncompressedSize?: number };
  unsafeOriginalName?: string;
}

interface ExportBudget {
  files: number;
  bytes: number;
}

interface ExportedPluginRoot {
  id: string;
  scope: BundleScope;
  source: string;
  installedPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedPath(value: string): string {
  const normalized = resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

function isWithinOrSame(filePath: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(filePath));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function bundleScope(scope: string): BundleScope {
  return scope === "project" ? "project" : "global";
}

function sdkScope(scope: BundleScope): "user" | "project" {
  return scope === "project" ? "project" : "user";
}

function packageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function packageFilters(entry: PackageSource): BundlePackageFilters | undefined {
  if (typeof entry === "string") return undefined;
  const filters: BundlePackageFilters = {};
  if (typeof entry.autoload === "boolean") filters.autoload = entry.autoload;
  for (const key of ["extensions", "skills", "prompts", "themes"] as const) {
    if (Array.isArray(entry[key])) filters[key] = [...entry[key]!];
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
}

function isRemotePackageSource(source: string): boolean {
  const value = source.trim().toLowerCase();
  return ["npm:", "git:", "github:", "http:", "https:", "ssh:"].some((prefix) => value.startsWith(prefix));
}

function safeSegment(value: string, fallback: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 48);
  return cleaned || fallback;
}

function safeLabel(value: string, fallback: string): string {
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 160);
  return cleaned || fallback;
}

function pathHash(value: string): string {
  return createHash("sha256").update(normalizedPath(value)).digest("hex").slice(0, 10);
}

function isSensitiveOrGeneratedEntry(name: string, directory: boolean): boolean {
  const lower = name.toLowerCase();
  if (directory && [".git", "node_modules", ".next", "coverage"].includes(lower)) return true;
  if ([".env", ".npmrc", ".pypirc", "auth.json", "credentials.json", "models.json"].includes(lower)) return true;
  if (lower.startsWith(".env.")) return true;
  if ([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"].includes(extname(lower))) return true;
  return ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"].includes(lower);
}

function addFileToArchive(zip: JSZip, sourcePath: string, archivePath: string, budget: ExportBudget): void {
  const stats = statSync(sourcePath);
  if (stats.size > MAX_SINGLE_FILE_BYTES) {
    throw new CapabilityBundleError(`File is too large to export: ${sourcePath}`, 413);
  }
  budget.files += 1;
  budget.bytes += stats.size;
  if (budget.files > MAX_ARCHIVE_ENTRIES - MAX_PLUGINS - 2 || budget.bytes > MAX_UNCOMPRESSED_BYTES) {
    throw new CapabilityBundleError("Capability bundle is too large to export", 413);
  }
  zip.file(archivePath.replaceAll("\\", "/"), readFileSync(sourcePath), {
    binary: true,
    unixPermissions: 0o600,
  });
}

function addPathToArchive(
  zip: JSZip,
  sourcePath: string,
  archivePath: string,
  budget: ExportBudget,
  warnings: string[],
): void {
  const stats = lstatSync(sourcePath);
  if (stats.isSymbolicLink()) {
    warnings.push(`Skipped symbolic link: ${archivePath}`);
    return;
  }
  if (stats.isFile()) {
    if (isSensitiveOrGeneratedEntry(sourcePath.split(/[\\/]/).at(-1) ?? "", false)) {
      warnings.push(`Skipped sensitive file: ${archivePath}`);
      return;
    }
    addFileToArchive(zip, sourcePath, archivePath, budget);
    return;
  }
  if (!stats.isDirectory()) return;
  const entries = readdirSync(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    if (isSensitiveOrGeneratedEntry(entry.name, entry.isDirectory())) {
      warnings.push(`Skipped sensitive or generated path: ${archivePath}/${entry.name}`);
      continue;
    }
    addPathToArchive(
      zip,
      join(sourcePath, entry.name),
      `${archivePath}/${entry.name}`,
      budget,
      warnings,
    );
  }
}

function portablePluginId(scope: BundleScope, source: string, index: number): string {
  return `plugin-${scope}-${index + 1}-${pathHash(source)}`;
}

function containsEmbeddedCredentials(source: string): boolean {
  const candidate = source.startsWith("git:") ? source.slice(4) : source;
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(candidate)) return false;
  try {
    const parsed = new URL(candidate);
    if (!parsed.username && !parsed.password) return false;
    return parsed.protocol !== "ssh:" || Boolean(parsed.password);
  } catch {
    return true;
  }
}

function pinInstalledNpmSource(source: string, installedPath?: string): string {
  if (!source.startsWith("npm:") || !installedPath) return source;
  let version: unknown;
  try {
    version = (JSON.parse(readFileSync(join(installedPath, "package.json"), "utf8")) as { version?: unknown }).version;
  } catch {
    return source;
  }
  if (typeof version !== "string" || !version) return source;
  const spec = source.slice(4);
  const versionSeparator = spec.lastIndexOf("@");
  const packageNameEnd = spec.startsWith("@") ? spec.indexOf("/", 1) : 0;
  const packageName = versionSeparator > packageNameEnd ? spec.slice(0, versionSeparator) : spec;
  return `npm:${packageName}@${version}`;
}

function packageEntryWithSource(source: string, filters?: BundlePackageFilters): PackageSource {
  return filters ? { source, ...filters } : source;
}

function resolveConfiguredLocalSource(source: string, scope: BundleScope, cwd: string, agentDir: string): string {
  if (isAbsolute(source)) return resolve(source);
  return resolve(scope === "project" ? join(cwd, ".pi") : agentDir, source);
}

function addPortableConfiguredPlugin(
  zip: JSZip,
  plugin: BundlePlugin,
  installedPath: string,
  budget: ExportBudget,
  warnings: string[],
): void {
  const portablePath = plugin.portablePath!;
  const stats = statSync(installedPath);
  if (stats.isDirectory()) {
    addPathToArchive(zip, installedPath, portablePath, budget, warnings);
    return;
  }
  const fileName = portablePluginFileName(installedPath);
  addFileToArchive(zip, installedPath, `${portablePath}/extensions/${fileName}`, budget);
  zip.file(`${portablePath}/package.json`, JSON.stringify({
    name: `piora-portable-${plugin.id}`,
    private: true,
    version: "1.0.0",
    type: "module",
    pi: { extensions: [`./extensions/${fileName}`] },
  }, null, 2));
}

function portablePluginFileName(installedPath: string): string {
  return safeSegment(installedPath.split(/[\\/]/).at(-1) ?? "extension.ts", "extension.ts");
}

function customExtensionRoot(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).at(-1)?.toLowerCase();
  const parent = dirname(filePath);
  if (fileName === "index.ts" || fileName === "index.js" || existsSync(join(parent, "package.json"))) return parent;
  return filePath;
}

function addCustomResource(
  zip: JSZip,
  packageArchivePath: string,
  kind: "extensions" | "skills",
  filePath: string,
  rootPath: string,
  budget: ExportBudget,
  warnings: string[],
  copiedRoots: Map<string, string>,
): string {
  const rootKey = normalizedPath(rootPath);
  let destination = copiedRoots.get(rootKey);
  if (!destination) {
    const baseName = safeSegment(rootPath.split(/[\\/]/).at(-1) ?? kind.slice(0, -1), kind.slice(0, -1));
    destination = `${kind}/${baseName}-${pathHash(rootPath)}`;
    copiedRoots.set(rootKey, destination);
    if (statSync(rootPath).isDirectory()) {
      addPathToArchive(zip, rootPath, `${packageArchivePath}/${destination}`, budget, warnings);
    } else {
      const extension = extname(rootPath);
      destination = `${kind}/${safeSegment(baseName.replace(new RegExp(`${extension.replace(".", "\\.")}$`), ""), kind.slice(0, -1))}-${pathHash(rootPath)}${extension}`;
      copiedRoots.set(rootKey, destination);
      addFileToArchive(zip, rootPath, `${packageArchivePath}/${destination}`, budget);
    }
  }
  if (statSync(rootPath).isFile()) return destination;
  return `${destination}/${relative(rootPath, filePath).replaceAll("\\", "/")}`;
}

function extensionStateKey(scope: BundleScope, source: string): string {
  return `${scope}\0${source}`;
}

function readBundleName(cwd: string): string {
  const folder = resolve(cwd).split(/[\\/]/).filter(Boolean).at(-1) ?? "Piora";
  return `${safeLabel(folder, "Piora")} capabilities`;
}

export async function exportCapabilityBundle(cwd: string): Promise<{ bytes: Buffer; manifest: CapabilityBundleManifest }> {
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const zip = new JSZip();
  const budget: ExportBudget = { files: 0, bytes: 0 };
  const warnings: string[] = [];
  const plugins: BundlePlugin[] = [];
  const pluginRoots: ExportedPluginRoot[] = [];
  const pluginIdsBySource = new Map<string, string>();
  const configured = packageManager.listConfiguredPackages();
  const configuredPaths = new Map(configured.map((item) => [extensionStateKey(bundleScope(item.scope), item.source), item.installedPath]));

  const appendPackages = (entries: PackageSource[], scope: BundleScope) => {
    entries.forEach((entry, index) => {
      const source = packageSource(entry);
      const id = portablePluginId(scope, source, plugins.length + index);
      const filters = packageFilters(entry);
      const label = safeLabel(source.split(/[\\/]/).filter(Boolean).at(-1) ?? source, "Local plugin");
      const installedPath = configuredPaths.get(extensionStateKey(scope, source));
      if (isRemotePackageSource(source)) {
        if (containsEmbeddedCredentials(source)) {
          warnings.push(`Skipped remote plugin with embedded credentials: ${label}`);
          return;
        }
        plugins.push({ id, scope, label, source: pinInstalledNpmSource(source, installedPath), ...(filters ? { filters } : {}) });
      } else {
        const localPath = installedPath ?? resolveConfiguredLocalSource(source, scope, cwd, agentDir);
        if (!existsSync(localPath)) {
          warnings.push(`Skipped missing local plugin: ${label}`);
          return;
        }
        const portablePath = `payload/plugins/${id}`;
        const plugin: BundlePlugin = { id, scope, label, portablePath, ...(filters ? { filters } : {}) };
        addPortableConfiguredPlugin(zip, plugin, localPath, budget, warnings);
        plugins.push(plugin);
      }
      pluginIdsBySource.set(extensionStateKey(scope, source), id);
      pluginRoots.push({ id, scope, source, installedPath });
    });
  };

  appendPackages(settingsManager.getGlobalSettings().packages ?? [], "global");
  appendPackages(settingsManager.getProjectSettings().packages ?? [], "project");

  const resolvedResources = await packageManager.resolve(async () => "skip");
  const loadedSkills = await loadSkillsWithInstallInfo(cwd);
  const skills: BundleSkill[] = loadedSkills.skills
    .filter((skill) => Boolean(skill.install))
    .map((skill) => ({
      package: skill.install!.package,
      scope: skill.install!.scope,
      disableModelInvocation: skill.disableModelInvocation,
    }));
  const installedSkillPaths = new Set(
    loadedSkills.skills.filter((skill) => skill.install).map((skill) => normalizedPath(skill.filePath)),
  );
  const skillByPath = new Map(loadedSkills.skills.map((skill) => [normalizedPath(skill.filePath), skill]));
  const extensionStates: BundleExtensionState[] = [];
  const skillStates: BundleSkillState[] = [];
  const extensionPlan = await resolveExtensionLoadPlan({
    cwd,
    agentDir,
    settingsManager,
    profile: "normal",
  });
  for (const candidate of extensionPlan.candidates) {
    if (candidate.builtIn) {
      extensionStates.push({ target: "builtin", id: candidate.id, enabled: candidate.enabled });
      continue;
    }
    if (candidate.metadata.origin !== "package") continue;
    const scope = bundleScope(candidate.metadata.scope);
    const pluginId = pluginIdsBySource.get(extensionStateKey(scope, candidate.metadata.source));
    if (!pluginId || !candidate.metadata.baseDir) continue;
    const pluginRoot = pluginRoots.find((item) => item.id === pluginId);
    const relativePath = pluginRoot?.installedPath && statSync(pluginRoot.installedPath).isFile()
      ? `extensions/${portablePluginFileName(pluginRoot.installedPath)}`
      : relative(candidate.metadata.baseDir, candidate.path).replaceAll("\\", "/");
    if (!relativePath.startsWith("../") && relativePath !== "..") {
      extensionStates.push({ target: "plugin", pluginId, relativePath, enabled: candidate.enabled });
    }
  }

  for (const skill of loadedSkills.skills) {
    if (skill.install) continue;
    const pluginRoot = pluginRoots.find((item) => item.installedPath && isWithinOrSame(skill.filePath, item.installedPath));
    if (!pluginRoot?.installedPath) continue;
    skillStates.push({
      pluginId: pluginRoot.id,
      relativePath: relative(pluginRoot.installedPath, skill.filePath).replaceAll("\\", "/"),
      disableModelInvocation: skill.disableModelInvocation,
    });
  }

  for (const scope of ["global", "project"] as const) {
    const packageId = `custom-${scope}`;
    const portablePath = `payload/${packageId}`;
    const copiedRoots = new Map<string, string>();
    const extensionEntries: string[] = [];
    const skillEntries: string[] = [];

    for (const candidate of extensionPlan.candidates) {
      if (candidate.builtIn || candidate.metadata.origin !== "top-level" || bundleScope(candidate.metadata.scope) !== scope) continue;
      const rootPath = customExtensionRoot(candidate.path);
      if (!existsSync(rootPath)) continue;
      const entry = addCustomResource(zip, portablePath, "extensions", candidate.path, rootPath, budget, warnings, copiedRoots);
      extensionEntries.push(`./${entry}`);
      extensionStates.push({ target: "plugin", pluginId: packageId, relativePath: entry, enabled: candidate.enabled });
    }

    for (const resource of resolvedResources.skills) {
      if (resource.metadata.origin !== "top-level" || bundleScope(resource.metadata.scope) !== scope) continue;
      if (installedSkillPaths.has(normalizedPath(resource.path))) continue;
      const skill = skillByPath.get(normalizedPath(resource.path));
      if (!skill || !existsSync(skill.filePath)) continue;
      const rootPath = skill.filePath.split(/[\\/]/).at(-1)?.toLowerCase() === "skill.md"
        ? dirname(skill.filePath)
        : skill.filePath;
      const entry = addCustomResource(zip, portablePath, "skills", skill.filePath, rootPath, budget, warnings, copiedRoots);
      skillEntries.push(`./${entry}`);
    }

    if (extensionEntries.length === 0 && skillEntries.length === 0) continue;
    zip.file(`${portablePath}/package.json`, JSON.stringify({
      name: `piora-imported-capabilities-${scope}`,
      version: "1.0.0",
      private: true,
      type: "module",
      pi: {
        ...(extensionEntries.length ? { extensions: [...new Set(extensionEntries)] } : {}),
        ...(skillEntries.length ? { skills: [...new Set(skillEntries)] } : {}),
      },
    }, null, 2));
    plugins.push({
      id: packageId,
      scope,
      label: scope === "global" ? "Custom global capabilities" : "Custom project capabilities",
      portablePath,
    });
  }

  const manifest: CapabilityBundleManifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    id: randomUUID(),
    name: readBundleName(cwd),
    createdAt: new Date().toISOString(),
    createdBy: { app: "Piora", version: packageMetadata.version, platform: process.platform },
    security: { secretsIncluded: false },
    plugins,
    skills,
    extensionStates,
    skillStates,
    warnings: [...new Set(warnings)],
  };
  zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    platform: process.platform === "win32" ? "DOS" : "UNIX",
  });
  if (bytes.byteLength > CAPABILITY_BUNDLE_MAX_ARCHIVE_BYTES) {
    throw new CapabilityBundleError("Capability bundle is too large to download", 413);
  }
  return { bytes, manifest };
}

export function assertSafeCapabilityArchivePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (
    value.includes("\0")
    || value.includes("\\")
    || normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new CapabilityBundleError("Capability bundle contains an unsafe path");
  }
  return segments.join("/");
}

function readString(value: unknown, label: string, maxLength = 2_048): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new CapabilityBundleError(`${label} is invalid`);
  }
  return value.trim();
}

function readScope(value: unknown, label: string): BundleScope {
  if (value !== "global" && value !== "project") throw new CapabilityBundleError(`${label} is invalid`);
  return value;
}

function readStringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_STATES || value.some((item) => (
    typeof item !== "string" || item.length > 1_024 || /[\u0000-\u001F\u007F]/.test(item)
  ))) {
    throw new CapabilityBundleError(`${label} is invalid`);
  }
  return [...value];
}

function readFilters(value: unknown): BundlePackageFilters | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new CapabilityBundleError("Plugin filters are invalid");
  const filters: BundlePackageFilters = {};
  if (value.autoload !== undefined) {
    if (typeof value.autoload !== "boolean") throw new CapabilityBundleError("Plugin autoload filter is invalid");
    filters.autoload = value.autoload;
  }
  for (const key of ["extensions", "skills", "prompts", "themes"] as const) {
    const list = readStringList(value[key], `Plugin ${key} filter`);
    if (list) filters[key] = list;
  }
  return Object.keys(filters).length > 0 ? filters : undefined;
}

export function validateCapabilityBundleManifest(value: unknown): CapabilityBundleManifest {
  if (!isRecord(value) || value.format !== BUNDLE_FORMAT || value.version !== BUNDLE_VERSION) {
    throw new CapabilityBundleError("Unsupported capability bundle format or version");
  }
  const id = readString(value.id, "Bundle id", 128);
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new CapabilityBundleError("Bundle id is invalid");
  const name = readString(value.name, "Bundle name", 160);
  const createdAt = readString(value.createdAt, "Bundle creation time", 64);
  if (!Number.isFinite(Date.parse(createdAt))) throw new CapabilityBundleError("Bundle creation time is invalid");
  if (!isRecord(value.security) || value.security.secretsIncluded !== false) {
    throw new CapabilityBundleError("Bundle does not declare the required secret-exclusion policy");
  }
  if (!Array.isArray(value.plugins) || value.plugins.length > MAX_PLUGINS) {
    throw new CapabilityBundleError("Bundle contains too many plugins");
  }
  const pluginIds = new Set<string>();
  const plugins = value.plugins.map((raw, index): BundlePlugin => {
    if (!isRecord(raw)) throw new CapabilityBundleError(`Plugin ${index + 1} is invalid`);
    const pluginId = readString(raw.id, `Plugin ${index + 1} id`, 128);
    if (!/^[A-Za-z0-9._-]+$/.test(pluginId) || pluginIds.has(pluginId)) {
      throw new CapabilityBundleError(`Plugin ${index + 1} id is invalid or duplicated`);
    }
    pluginIds.add(pluginId);
    const source = raw.source === undefined ? undefined : readString(raw.source, `Plugin ${index + 1} source`);
    const portablePath = raw.portablePath === undefined
      ? undefined
      : assertSafeCapabilityArchivePath(readString(raw.portablePath, `Plugin ${index + 1} portable path`));
    if (Boolean(source) === Boolean(portablePath) || (portablePath && !portablePath.startsWith("payload/"))) {
      throw new CapabilityBundleError(`Plugin ${index + 1} must have exactly one valid source`);
    }
    if (source && (!isRemotePackageSource(source) || containsEmbeddedCredentials(source))) {
      throw new CapabilityBundleError(`Plugin ${index + 1} remote source is unsafe`);
    }
    return {
      id: pluginId,
      scope: readScope(raw.scope, `Plugin ${index + 1} scope`),
      label: readString(raw.label, `Plugin ${index + 1} label`, 160),
      ...(source ? { source } : {}),
      ...(portablePath ? { portablePath } : {}),
      ...(raw.filters === undefined ? {} : { filters: readFilters(raw.filters) }),
    };
  });

  if (!Array.isArray(value.skills) || value.skills.length > MAX_SKILLS) {
    throw new CapabilityBundleError("Bundle contains too many skills");
  }
  const skills = value.skills.map((raw, index): BundleSkill => {
    if (!isRecord(raw) || typeof raw.disableModelInvocation !== "boolean") {
      throw new CapabilityBundleError(`Skill ${index + 1} is invalid`);
    }
    return {
      package: readString(raw.package, `Skill ${index + 1} package`),
      scope: readScope(raw.scope, `Skill ${index + 1} scope`),
      disableModelInvocation: raw.disableModelInvocation,
    };
  });

  if (!Array.isArray(value.extensionStates) || value.extensionStates.length > MAX_STATES) {
    throw new CapabilityBundleError("Bundle contains too many extension states");
  }
  const extensionStates = value.extensionStates.map((raw, index): BundleExtensionState => {
    if (!isRecord(raw) || typeof raw.enabled !== "boolean") {
      throw new CapabilityBundleError(`Extension state ${index + 1} is invalid`);
    }
    if (raw.target === "builtin") {
      return { target: "builtin", id: readString(raw.id, `Extension state ${index + 1} id`, 256), enabled: raw.enabled };
    }
    if (raw.target === "plugin") {
      const pluginId = readString(raw.pluginId, `Extension state ${index + 1} plugin id`, 128);
      if (!pluginIds.has(pluginId)) throw new CapabilityBundleError(`Extension state ${index + 1} references an unknown plugin`);
      return {
        target: "plugin",
        pluginId,
        relativePath: assertSafeCapabilityArchivePath(readString(raw.relativePath, `Extension state ${index + 1} path`)),
        enabled: raw.enabled,
      };
    }
    throw new CapabilityBundleError(`Extension state ${index + 1} target is invalid`);
  });

  if (!Array.isArray(value.skillStates) || value.skillStates.length > MAX_STATES) {
    throw new CapabilityBundleError("Bundle contains too many skill states");
  }
  const skillStates = value.skillStates.map((raw, index): BundleSkillState => {
    if (!isRecord(raw) || typeof raw.disableModelInvocation !== "boolean") {
      throw new CapabilityBundleError(`Skill state ${index + 1} is invalid`);
    }
    const pluginId = readString(raw.pluginId, `Skill state ${index + 1} plugin id`, 128);
    if (!pluginIds.has(pluginId)) throw new CapabilityBundleError(`Skill state ${index + 1} references an unknown plugin`);
    return {
      pluginId,
      relativePath: assertSafeCapabilityArchivePath(readString(raw.relativePath, `Skill state ${index + 1} path`)),
      disableModelInvocation: raw.disableModelInvocation,
    };
  });
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.filter((item): item is string => typeof item === "string").slice(0, MAX_STATES)
    : [];
  const createdBy = isRecord(value.createdBy) ? value.createdBy : {};
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    id,
    name,
    createdAt,
    createdBy: {
      app: "Piora",
      version: typeof createdBy.version === "string" ? createdBy.version.slice(0, 64) : "unknown",
      platform: typeof createdBy.platform === "string" ? createdBy.platform as NodeJS.Platform : process.platform,
    },
    security: { secretsIncluded: false },
    plugins,
    skills,
    extensionStates,
    skillStates,
    warnings,
  };
}

async function readZipEntry(entry: SizedZipObject, limit: number, label: string): Promise<Buffer> {
  const declared = entry._data?.uncompressedSize;
  if (typeof declared === "number" && declared > limit) throw new CapabilityBundleError(`${label} is too large`, 413);
  const bytes = await entry.async("nodebuffer");
  if (bytes.byteLength > limit) throw new CapabilityBundleError(`${label} is too large`, 413);
  return bytes;
}

function permanentImportRoot(agentDir: string, archiveBytes: Buffer): string {
  const hash = createHash("sha256").update(archiveBytes).digest("hex").slice(0, 24);
  return join(agentDir, "piora", "imported-capabilities", hash);
}

async function extractPortablePayload(
  archive: JSZip,
  manifest: CapabilityBundleManifest,
  destination: string,
): Promise<void> {
  if (existsSync(destination)) return;
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = join(parent, `.${destination.split(/[\\/]/).at(-1)}-${randomUUID()}.staging`);
  mkdirSync(staging, { recursive: false, mode: 0o700 });
  const portableRoots = manifest.plugins.flatMap((plugin) => plugin.portablePath ? [plugin.portablePath] : []);
  let total = 0;
  try {
    for (const rawEntry of Object.values(archive.files) as SizedZipObject[]) {
      assertSafeCapabilityArchivePath(rawEntry.unsafeOriginalName ?? rawEntry.name);
      if (rawEntry.dir) continue;
      const entryName = assertSafeCapabilityArchivePath(rawEntry.name);
      const root = portableRoots.find((candidate) => entryName === candidate || entryName.startsWith(`${candidate}/`));
      if (!root) continue;
      const relativePath = entryName.slice(root.length).replace(/^\//, "");
      if (!relativePath) continue;
      const bytes = await readZipEntry(rawEntry, MAX_SINGLE_FILE_BYTES, entryName);
      total += bytes.byteLength;
      if (total > MAX_UNCOMPRESSED_BYTES) throw new CapabilityBundleError("Capability bundle expands beyond the allowed size", 413);
      const target = resolve(staging, root, ...relativePath.split("/"));
      const expectedRoot = resolve(staging);
      if (!isWithinOrSame(target, expectedRoot)) throw new CapabilityBundleError("Capability bundle contains an unsafe path");
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, bytes, { mode: 0o600 });
    }
    for (const root of portableRoots) {
      const rootPath = resolve(staging, ...root.split("/"));
      if (!existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
        throw new CapabilityBundleError(`Portable plugin payload is missing: ${root}`);
      }
    }
    try {
      renameSync(staging, destination);
    } catch (error) {
      if (!existsSync(destination)) throw error;
    }
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}

function findNpmCli(): string | undefined {
  const nodeDir = dirname(execPath);
  return [
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].find(existsSync);
}

async function restorePortableDependencies(packageRoot: string): Promise<boolean> {
  const packageJsonPath = join(packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) return false;
  let dependencies: unknown;
  try {
    dependencies = (JSON.parse(readFileSync(packageJsonPath, "utf8")) as { dependencies?: unknown }).dependencies;
  } catch {
    return false;
  }
  if (!isRecord(dependencies) || Object.keys(dependencies).length === 0) return false;
  const npmCli = findNpmCli();
  if (!npmCli) throw new Error("npm runtime was not found");
  await execFileAsync(execPath, [npmCli, "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: packageRoot,
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  return true;
}

function settingSourceMatches(
  candidate: string,
  desired: string,
  scope: BundleScope,
  cwd: string,
  agentDir: string,
): boolean {
  if (isRemotePackageSource(desired)) return candidate === desired;
  return normalizedPath(resolveConfiguredLocalSource(candidate, scope, cwd, agentDir)) === normalizedPath(desired);
}

function replacePackageFilters(
  settingsManager: SettingsManager,
  desiredSource: string,
  scope: BundleScope,
  filters: BundlePackageFilters | undefined,
  cwd: string,
  agentDir: string,
): string {
  const current = scope === "project"
    ? settingsManager.getProjectSettings().packages ?? []
    : settingsManager.getGlobalSettings().packages ?? [];
  let actualSource = desiredSource;
  const next = current.map((entry): PackageSource => {
    const source = packageSource(entry);
    if (!settingSourceMatches(source, desiredSource, scope, cwd, agentDir)) return entry;
    actualSource = source;
    return packageEntryWithSource(source, filters);
  });
  if (scope === "project") settingsManager.setProjectPackages(next);
  else settingsManager.setPackages(next);
  return actualSource;
}

function setSkillInvocationState(filePath: string, disabled: boolean): boolean {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const content = readFileSync(filePath, "utf8");
  const key = "disable-model-invocation";
  const keyPattern = new RegExp(`^${key}\\s*:.*(?:\\r?\\n|$)`, "m");
  const currentlyDisabled = keyPattern.test(content);
  if (currentlyDisabled === disabled) return true;
  let updated = content;
  if (disabled) {
    updated = content.replace(/^---\r?\n/, `---\n${key}: true\n`);
    if (updated === content) updated = `---\n${key}: true\n---\n${content}`;
  } else {
    updated = content.replace(keyPattern, "");
  }
  writeFileSync(filePath, updated, "utf8");
  return true;
}

export async function importCapabilityBundle(archiveBytes: Buffer, cwd: string): Promise<CapabilityBundleImportResult> {
  if (archiveBytes.byteLength === 0) throw new CapabilityBundleError("Capability bundle is empty");
  if (archiveBytes.byteLength > CAPABILITY_BUNDLE_MAX_ARCHIVE_BYTES) {
    throw new CapabilityBundleError("Capability bundle is too large", 413);
  }
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(archiveBytes, { createFolders: false });
  } catch {
    throw new CapabilityBundleError("Capability bundle is not a valid ZIP file");
  }
  const entries = Object.values(archive.files) as SizedZipObject[];
  if (entries.length === 0 || entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new CapabilityBundleError("Capability bundle contains too many entries");
  }
  let declaredTotal = 0;
  for (const entry of entries) {
    assertSafeCapabilityArchivePath(entry.unsafeOriginalName ?? entry.name);
    const declared = entry._data?.uncompressedSize;
    if (typeof declared === "number") declaredTotal += declared;
    if (declaredTotal > MAX_UNCOMPRESSED_BYTES) {
      throw new CapabilityBundleError("Capability bundle expands beyond the allowed size", 413);
    }
  }
  const manifestEntry = entries.find((entry) => !entry.dir && entry.name === "manifest.json");
  if (!manifestEntry) throw new CapabilityBundleError("Capability bundle is missing manifest.json");
  let manifestValue: unknown;
  try {
    const manifestBytes = await readZipEntry(manifestEntry, 2 * 1024 * 1024, "manifest.json");
    manifestValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch (error) {
    if (error instanceof CapabilityBundleError) throw error;
    throw new CapabilityBundleError("Capability bundle manifest is invalid JSON");
  }
  const manifest = validateCapabilityBundleManifest(manifestValue);
  const agentDir = getAgentDir();
  const destination = permanentImportRoot(agentDir, archiveBytes);
  await extractPortablePayload(archive, manifest, destination);

  const warnings = [...manifest.warnings];
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const installedPluginSources = new Map<string, { source: string; root?: string }>();
  let pluginsInstalled = 0;
  let skillsInstalled = 0;
  let extensionStatesApplied = 0;
  let skillStatesApplied = 0;

  for (const plugin of manifest.plugins) {
    const portableRoot = plugin.portablePath
      ? resolve(destination, ...plugin.portablePath.split("/"))
      : undefined;
    const desiredSource = portableRoot ?? plugin.source!;
    try {
      if (portableRoot) {
        try {
          await restorePortableDependencies(portableRoot);
        } catch (error) {
          warnings.push(`${plugin.label}: dependencies could not be restored safely (${error instanceof Error ? error.message : String(error)})`);
        }
      }
      await packageManager.installAndPersist(desiredSource, { local: plugin.scope === "project" });
      const actualSource = replacePackageFilters(settingsManager, desiredSource, plugin.scope, plugin.filters, cwd, agentDir);
      installedPluginSources.set(plugin.id, { source: actualSource, ...(portableRoot ? { root: portableRoot } : {}) });
      pluginsInstalled += 1;
    } catch (error) {
      warnings.push(`${plugin.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await settingsManager.flush();

  for (const skill of manifest.skills) {
    try {
      const args = ["skills", "add", skill.package, "-y", "--agent", "pi"];
      if (skill.scope === "global") args.push("-g");
      await runNpx(args, {
        timeout: 60_000,
        cwd: skill.scope === "project" ? cwd : undefined,
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      skillsInstalled += 1;
    } catch (error) {
      warnings.push(`${skill.package}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const refreshedSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const refreshedPackageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager: refreshedSettings });
  const extensionPlan = await resolveExtensionLoadPlan({
    cwd,
    agentDir,
    settingsManager: refreshedSettings,
    profile: "normal",
  });
  for (const state of manifest.extensionStates) {
    if (state.target === "builtin") {
      const candidate = extensionPlan.candidates.find((item) => item.id === state.id);
      if (!candidate) {
        warnings.push(`Extension is unavailable in this Piora version: ${state.id}`);
        continue;
      }
      try {
        setExtensionEnabled(candidate.id, state.enabled);
        extensionStatesApplied += 1;
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    const installed = installedPluginSources.get(state.pluginId);
    if (!installed) continue;
    const installedPath = installed.root
      ?? refreshedPackageManager.getInstalledPath(installed.source, sdkScope(manifest.plugins.find((plugin) => plugin.id === state.pluginId)!.scope));
    const candidate = extensionPlan.candidates.find((item) => {
      if (!item.metadata.baseDir) return false;
      if (installedPath && !isWithinOrSame(item.path, installedPath)) return false;
      return relative(item.metadata.baseDir, item.path).replaceAll("\\", "/") === state.relativePath;
    });
    if (!candidate) {
      warnings.push(`Extension state could not be matched: ${state.relativePath}`);
      continue;
    }
    try {
      setExtensionEnabled(candidate.id, state.enabled);
      extensionStatesApplied += 1;
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const state of manifest.skillStates) {
    const plugin = manifest.plugins.find((item) => item.id === state.pluginId);
    const installed = installedPluginSources.get(state.pluginId);
    if (!plugin || !installed) continue;
    const root = installed.root ?? refreshedPackageManager.getInstalledPath(installed.source, sdkScope(plugin.scope));
    if (!root) continue;
    const target = resolve(root, ...state.relativePath.split("/"));
    if (!isWithinOrSame(target, root)) continue;
    if (setSkillInvocationState(target, state.disableModelInvocation)) skillStatesApplied += 1;
  }

  const refreshedSkills = await loadSkillsWithInstallInfo(cwd);
  for (const skillState of manifest.skills) {
    const skill = refreshedSkills.skills.find((item) => (
      item.install?.package === skillState.package && item.install.scope === skillState.scope
    ));
    if (skill && setSkillInvocationState(skill.filePath, skillState.disableModelInvocation)) skillStatesApplied += 1;
  }

  invalidateServicesCache();
  return {
    success: true,
    name: manifest.name,
    summary: { pluginsInstalled, skillsInstalled, extensionStatesApplied, skillStatesApplied },
    warnings: [...new Set(warnings)],
    reloadRequired: true,
  };
}
