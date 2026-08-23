import { existsSync, lstatSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const PORTABLE_FILE_PATTERN = /^Piora-(\d+)\.(\d+)\.(\d+)-win-x64-portable\.exe$/i;
const PACKAGED_FILE_PATTERN = /^Piora\.exe$/i;
const SHORTCUT_APP_ID = "io.github.kexijiang.piora";
const SHORTCUT_VERSION_PATTERN = /^Piora (\d+\.\d+\.\d+) — /;

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
  readShortcutLink(path: string): PortableShortcutDetails;
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
  | { status: "created" | "updated"; shortcutPath: string; target: string }
  | { status: "kept-newer"; shortcutPath: string; target: string }
  | { status: "skipped"; reason: string };

function regularFileExists(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

export function portableVersionFromPath(path: string): readonly [bigint, bigint, bigint] | undefined {
  const match = PORTABLE_FILE_PATTERN.exec(basename(path.replaceAll("\\", "/")));
  if (!match) return undefined;
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  return [BigInt(major), BigInt(minor), BigInt(patch)];
}

export function parseDesktopVersion(value: string): readonly [bigint, bigint, bigint] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return undefined;
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  return [BigInt(major), BigInt(minor), BigInt(patch)];
}

export function comparePortableVersions(
  left: readonly [bigint, bigint, bigint],
  right: readonly [bigint, bigint, bigint],
): number {
  for (const index of [0, 1, 2] as const) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

export function ensurePortableDesktopShortcut(
  options: PortableShortcutOptions,
): PortableShortcutResult {
  if (options.platform !== "win32") return { status: "skipped", reason: "unsupported-platform" };
  if (!options.isPackaged) return { status: "skipped", reason: "development-runtime" };
  if (options.isSmokeTest) return { status: "skipped", reason: "smoke-test" };

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

  const shortcutPath = join(resolve(options.desktopDirectory), "Piora.lnk");
  const shortcutExists = existsSync(shortcutPath);
  if (shortcutExists) {
    try {
      const existing = options.shell.readShortcutLink(shortcutPath);
      const existingTarget = resolve(existing.target);
      const describedVersion = existing.description
        ? parseDesktopVersion(SHORTCUT_VERSION_PATTERN.exec(existing.description)?.[1] ?? "")
        : undefined;
      const existingVersion = existing.appUserModelId === SHORTCUT_APP_ID
        ? portableVersionFromPath(existingTarget) ?? describedVersion
        : undefined;
      if (
        existingVersion
        && regularFileExists(existingTarget)
        && comparePortableVersions(existingVersion, appVersion) >= 0
      ) {
        return { status: "kept-newer", shortcutPath, target: existingTarget };
      }
    } catch {
      // Replace an unreadable app-owned shortcut with a verified current target.
    }
  }

  const iconAvailable = regularFileExists(options.iconPath);
  const written = options.shell.writeShortcutLink(
    shortcutPath,
    shortcutExists ? "replace" : "create",
    {
      target,
      cwd: dirname(target),
      description: `Piora ${options.appVersion} — ${options.description}`,
      appUserModelId: SHORTCUT_APP_ID,
      ...(iconAvailable ? { icon: options.iconPath, iconIndex: 0 } : {}),
    },
  );
  if (!written) throw new Error("Windows rejected the Piora desktop shortcut update.");
  return { status: shortcutExists ? "updated" : "created", shortcutPath, target };
}
