import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { HarmonyError } from "./errors";
import type { HarmonyConfig, HarmonyRuntimeCandidate } from "./types";

export interface HarmonyRuntimeResolution {
  hdcPath: string;
  source: "explicit" | "environment" | "config" | "deveco" | "path";
}

export interface ResolveHdcOptions {
  explicitPath?: string;
  env?: NodeJS.ProcessEnv;
  config?: HarmonyConfig;
  homeDir?: string;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  listDirectory?: (path: string) => string[];
}

export interface DiscoverHdcOptions extends ResolveHdcOptions {
  selectionPath?: string;
}

const HDC_ENV_NAMES = ["PIORA_HARMONY_HDC_PATH", "HARMONY_HDC_PATH", "HDC_PATH"] as const;

function isUsableFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function normalizeCandidate(candidate: string | undefined): string | undefined {
  if (!candidate?.trim()) return undefined;
  const absolute = isAbsolute(candidate.trim()) ? candidate.trim() : resolve(candidate.trim());
  return absolute;
}

function versionDirectories(root: string, listDirectory: (path: string) => string[]): string[] {
  try {
    return listDirectory(root)
      .filter((entry) => /^\d+(?:\.\d+)*(?:[-_A-Za-z0-9.]*)?$/.test(entry))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

function devecoCandidates(
  homeDir: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  listDirectory: (path: string) => string[],
): string[] {
  const executable = platform === "win32" ? "hdc.exe" : "hdc";
  const localAppData = env.LOCALAPPDATA || join(homeDir, "AppData", "Local");
  const programFiles = env.ProgramFiles || "C:\\Program Files";
  const sdkRoots = [
    join(localAppData, "Huawei", "Sdk"),
    join(localAppData, "Huawei", "Sdk", "openharmony"),
    join(homeDir, "Huawei", "Sdk"),
  ];
  const result = [
    join(programFiles, "Huawei", "DevEco Studio", "sdk", "default", "openharmony", "toolchains", executable),
    join(programFiles, "Huawei", "DevEco Studio", "sdk", "default", "toolchains", executable),
    join(localAppData, "Programs", "Huawei", "DevEco Studio", "sdk", "default", "openharmony", "toolchains", executable),
  ];

  for (const sdkRoot of sdkRoots) {
    result.push(join(sdkRoot, "default", "openharmony", "toolchains", executable));
    result.push(join(sdkRoot, "default", "toolchains", executable));
    for (const version of versionDirectories(sdkRoot, listDirectory)) {
      result.push(join(sdkRoot, version, "openharmony", "toolchains", executable));
      result.push(join(sdkRoot, version, "toolchains", executable));
    }
  }
  return result;
}

function selectedCandidates(selectionPath: string, platform: NodeJS.Platform, listDirectory: (path: string) => string[]): string[] {
  const selected = normalizeCandidate(selectionPath);
  if (!selected) return [];
  const executable = platform === "win32" ? "hdc.exe" : "hdc";
  if (basename(selected).toLocaleLowerCase() === executable.toLocaleLowerCase()) return [selected];
  const roots = [selected];
  for (const version of versionDirectories(selected, listDirectory)) roots.push(join(selected, version));
  return roots.flatMap((root) => [
    join(root, executable),
    join(root, "toolchains", executable),
    join(root, "openharmony", "toolchains", executable),
    join(root, "default", "toolchains", executable),
    join(root, "default", "openharmony", "toolchains", executable),
  ]);
}

function inferSdkPath(hdcPath: string): string {
  const toolchains = dirname(hdcPath);
  return basename(toolchains).toLocaleLowerCase() === "toolchains"
    ? dirname(toolchains)
    : toolchains;
}

export function discoverHdcCandidates(options: DiscoverHdcOptions = {}): HarmonyRuntimeCandidate[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const exists = options.exists ?? isUsableFile;
  const listDirectory = options.listDirectory ?? ((path) => readdirSync(path));
  const executable = platform === "win32" ? "hdc.exe" : "hdc";
  const candidates: Array<{ path: string | undefined; source: HarmonyRuntimeCandidate["source"] }> = [];

  if (options.selectionPath) {
    candidates.push(...selectedCandidates(options.selectionPath, platform, listDirectory).map((path) => ({ path, source: "selection" as const })));
  }
  for (const name of HDC_ENV_NAMES) candidates.push({ path: env[name], source: "environment" });
  candidates.push({ path: options.config?.hdcPath, source: "config" });
  candidates.push(...devecoCandidates(homeDir, env, platform, listDirectory).map((path) => ({ path, source: "deveco" as const })));
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (directory.trim()) candidates.push({ path: join(directory.replace(/^"|"$/g, ""), executable), source: "path" });
  }

  const seen = new Set<string>();
  const result: HarmonyRuntimeCandidate[] = [];
  for (const candidate of candidates) {
    const hdcPath = normalizeCandidate(candidate.path);
    if (!hdcPath || !exists(hdcPath)) continue;
    const key = platform === "win32" ? hdcPath.toLocaleLowerCase() : hdcPath;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ hdcPath, sdkPath: inferSdkPath(hdcPath), source: candidate.source });
  }
  return result;
}

export function resolveHdcPath(options: ResolveHdcOptions = {}): HarmonyRuntimeResolution {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir();
  const exists = options.exists ?? isUsableFile;
  const listDirectory = options.listDirectory ?? ((path) => readdirSync(path));
  const executable = platform === "win32" ? "hdc.exe" : "hdc";

  const check = (candidate: string | undefined): string | undefined => {
    const normalized = normalizeCandidate(candidate);
    return normalized && exists(normalized) ? normalized : undefined;
  };

  const explicit = check(options.explicitPath);
  if (explicit) return { hdcPath: explicit, source: "explicit" };
  if (options.explicitPath?.trim()) {
    throw new HarmonyError("HDC_INVALID", "The configured HDC executable does not exist", {
      details: { source: "explicit" },
    });
  }

  for (const name of HDC_ENV_NAMES) {
    const environment = check(env[name]);
    if (environment) return { hdcPath: environment, source: "environment" };
  }

  const configured = check(options.config?.hdcPath);
  if (configured) return { hdcPath: configured, source: "config" };

  for (const candidate of devecoCandidates(homeDir, env, platform, listDirectory)) {
    const discovered = check(candidate);
    if (discovered) return { hdcPath: discovered, source: "deveco" };
  }

  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory.trim()) continue;
    const fromPath = check(join(directory.replace(/^"|"$/g, ""), executable));
    if (fromPath) return { hdcPath: fromPath, source: "path" };
  }

  throw new HarmonyError("HDC_NOT_FOUND", "HDC was not found. Select hdc.exe from a HarmonyOS SDK installation.", {
    retryable: true,
  });
}

export function defaultHarmonyConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PIORA_HARMONY_CONFIG_PATH?.trim()) return resolve(env.PIORA_HARMONY_CONFIG_PATH.trim());
  if (env.PIORA_DESKTOP_DATA_DIR?.trim()) return join(resolve(env.PIORA_DESKTOP_DATA_DIR.trim()), "harmony.json");
  const base = env.APPDATA?.trim() || join(homedir(), ".piora");
  return join(base, "Piora", "harmony.json");
}

export function readHarmonyConfig(path = defaultHarmonyConfigPath()): HarmonyConfig {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as { hdcPath?: unknown; vision?: unknown };
    const config: HarmonyConfig = {};
    if (typeof record.hdcPath === "string" && record.hdcPath.trim()) config.hdcPath = normalizeCandidate(record.hdcPath);
    if (record.vision && typeof record.vision === "object" && !Array.isArray(record.vision)) {
      const vision = record.vision as Record<string, unknown>;
      if (typeof vision.enabled === "boolean" && typeof vision.provider === "string" && typeof vision.modelId === "string") {
        const provider = vision.provider.trim();
        const modelId = vision.modelId.trim();
        if (provider && modelId) {
          config.vision = {
            enabled: vision.enabled,
            provider,
            modelId,
            ...(vision.shareScreenshotWithActionModel === true ? { shareScreenshotWithActionModel: true } : {}),
          };
        }
      }
    }
    return config;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || error instanceof SyntaxError) return {};
    throw new HarmonyError("INTERNAL_ERROR", "Unable to read Harmony device configuration", { cause: error });
  }
}

export function writeHarmonyConfig(config: HarmonyConfig, path = defaultHarmonyConfigPath()): HarmonyConfig {
  const normalized: HarmonyConfig = {};
  if (config.hdcPath?.trim()) {
    const requested = config.hdcPath.trim();
    if (!isAbsolute(requested)) {
      throw new HarmonyError("INVALID_ARGUMENT", "HDC path must be absolute");
    }
    const absolute = normalizeCandidate(requested);
    if (!absolute) throw new HarmonyError("INVALID_ARGUMENT", "HDC path must be absolute");
    normalized.hdcPath = absolute;
  }
  if (config.vision) {
    const provider = config.vision.provider.trim();
    const modelId = config.vision.modelId.trim();
    if (!provider || !modelId || provider.length > 160 || modelId.length > 240) {
      throw new HarmonyError("INVALID_ARGUMENT", "Vision provider and model are required and must be within limits");
    }
    normalized.vision = {
      enabled: Boolean(config.vision.enabled),
      provider,
      modelId,
      ...(config.vision.shareScreenshotWithActionModel ? { shareScreenshotWithActionModel: true } : {}),
    };
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, path);
    return normalized;
  } catch (error) {
    throw new HarmonyError("INTERNAL_ERROR", "Unable to save Harmony device configuration", { cause: error });
  }
}

export function isHdcPathPresent(path: string): boolean {
  return existsSync(path) && isUsableFile(path);
}
