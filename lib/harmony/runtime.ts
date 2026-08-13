import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { HarmonyError } from "./errors";
import type { HarmonyConfig } from "./types";

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
    const hdcPath = (parsed as { hdcPath?: unknown }).hdcPath;
    return typeof hdcPath === "string" && hdcPath.trim()
      ? { hdcPath: normalizeCandidate(hdcPath) }
      : {};
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
