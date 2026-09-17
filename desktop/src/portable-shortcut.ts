import { existsSync, lstatSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { APP_BRAND, APP_DISPLAY_NAME } from "./branding.js";

const PACKAGED_FILE_PATTERN = /^Piora\.exe$/i;
const SHORTCUT_APP_ID = "io.github.kexijiang.piora";

export interface PortableShortcutDetails {
  target: string;
  args?: string;
  cwd?: string;
  description?: string;
  icon?: string;
  iconIndex?: number;
  appUserModelId?: string;
}

export interface PortableShortcutShell {
  writeShortcutLink(
    path: string,
    operation: "create" | "replace",
    details: PortableShortcutDetails,
  ): boolean;
}

export interface PortableShortcutOptions {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  isSmokeTest: boolean;
  appVersion: string;
  portableExecutablePath?: string;
  packagedExecutablePath: string;
  desktopDirectory: string;
  iconPath: string;
  description: string;
  shell: PortableShortcutShell;
}

export type PortableShortcutResult =
  | { status: "created"; shortcutPath: string; target: string }
  | { status: "kept-existing"; shortcutPath: string }
  | { status: "skipped"; reason: string };

function regularFileExists(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

type DesktopVersion = readonly [bigint, bigint, bigint, bigint?];

export function portableVersionFromPath(path: string, artifactPrefix: string = APP_BRAND.artifactPrefix): DesktopVersion | undefined {
  const filename = basename(path.replaceAll("\\", "/"));
  const prefix = `${artifactPrefix}-`;
  if (!filename.startsWith(prefix) || !filename.endsWith("-win-x64-portable.exe")) return undefined;
  return parseDesktopVersion(filename.slice(prefix.length, -"-win-x64-portable.exe".length));
}

export function parseDesktopVersion(value: string): DesktopVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(value);
  if (!match) return undefined;
  const [, major, minor, patch, beta] = match;
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  if (beta !== undefined) return [BigInt(major), BigInt(minor), BigInt(patch), BigInt(beta)];
  return [BigInt(major), BigInt(minor), BigInt(patch)];
}

export function comparePortableVersions(
  left: DesktopVersion,
  right: DesktopVersion,
): number {
  for (const index of [0, 1, 2] as const) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  if (left[3] === right[3]) return 0;
  if (left[3] === undefined) return 1;
  if (right[3] === undefined) return -1;
  return left[3] > right[3] ? 1 : -1;
}

export function ensurePortableDesktopShortcut(
  options: PortableShortcutOptions,
): PortableShortcutResult {
  if (options.platform !== "win32") return { status: "skipped", reason: "unsupported-platform" };
  if (!options.isPackaged) return { status: "skipped", reason: "development-runtime" };
  if (options.isSmokeTest) return { status: "skipped", reason: "smoke-test" };

  const shortcutPath = join(resolve(options.desktopDirectory), `${APP_DISPLAY_NAME}.lnk`);
  if (existsSync(shortcutPath)) return { status: "kept-existing", shortcutPath };

  const requestedPath = options.portableExecutablePath?.trim();
  const appVersion = parseDesktopVersion(options.appVersion);
  if (!appVersion) return { status: "skipped", reason: "invalid-app-version" };
  const target = resolve(requestedPath || options.packagedExecutablePath);
  if (!regularFileExists(target)) {
    return { status: "skipped", reason: "missing-packaged-executable" };
  }
  const portableVersion = portableVersionFromPath(target);
  if (requestedPath) {
    if (!portableVersion) return { status: "skipped", reason: "invalid-portable-executable" };
    if (comparePortableVersions(portableVersion, appVersion) !== 0) {
      return { status: "skipped", reason: "version-mismatch" };
    }
  } else if (!PACKAGED_FILE_PATTERN.test(basename(target))) {
    return { status: "skipped", reason: "invalid-packaged-executable" };
  }

  const iconAvailable = regularFileExists(options.iconPath);
  const written = options.shell.writeShortcutLink(
    shortcutPath,
    "create",
    {
      target,
      cwd: dirname(target),
      description: `${APP_DISPLAY_NAME} ${options.appVersion} — ${options.description}`,
      appUserModelId: SHORTCUT_APP_ID,
      ...(iconAvailable ? { icon: options.iconPath, iconIndex: 0 } : {}),
    },
  );
  if (!written) throw new Error("Windows rejected the Piora desktop shortcut creation.");
  return { status: "created", shortcutPath, target };
}
