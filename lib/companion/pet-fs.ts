/*
 * MODIFIED APACHE-2.0 ADAPTATION NOTICE
 *
 * This file contains a modified TypeScript adaptation of portions of the
 * OpenAI Codex TUI pet catalog, model, and asset-cache conventions.
 * Copyright 2025 OpenAI. Modified by Piora contributors for local discovery,
 * validation, normalization, and atomic import behavior.
 *
 * See third_party/openai-codex/SOURCE.md, LICENSE, and NOTICE for the pinned
 * upstream revision and Apache-2.0 attribution. The Piora project as a whole
 * remains distributed under its existing MIT license.
 */

import fs from "node:fs";
import path from "node:path";
import { firstPartyRuntimeRoot } from "../first-party-extensions";
import {
  getRuntimeAgentDataDirectory,
  getRuntimeHomeDirectory,
} from "../runtime-home";
import {
  CompanionPetError,
  isPlainRecord,
  normalizePetManifest,
  normalizeSpritesheetSourcePath,
  PET_INSTALLED_MANIFEST_MAX_BYTES,
  PET_MANIFEST_MAX_BYTES,
  PET_SPRITESHEET_MAX_BYTES,
  petFromManifest,
  requireValidPetId,
  type CodexBuiltinPetCatalogEntry,
  type CompanionPetEnvironment,
  type CompanionPetSourceKind,
  type ValidatedPetPackage,
} from "./pet-manifest";
import { assertAtlasGeometry, inspectPetSpritesheetBytes } from "./sprite-inspector";

export function isContainedPath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function hasSameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function hasSameResolvedPath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US")
    : left === right;
}

/**
 * Read a package file through one descriptor and never allocate beyond the
 * declared bound. Path and descriptor identities are checked before and after
 * the read so a concurrent symlink/file swap is rejected rather than followed.
 */
export function readBoundedRegularFile(
  root: string,
  fileName: string,
  maxBytes: number,
  label: string,
  immutableBundledResource = false,
): Buffer {
  const candidate = path.join(root, fileName);
  let current = root;
  for (const segment of path.relative(root, candidate).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new CompanionPetError(
          `${label} path must not contain symbolic links`,
          "PET_ACCESS_DENIED",
          403,
        );
      }
    } catch (error) {
      if (error instanceof CompanionPetError) throw error;
      throw new CompanionPetError(`${label} is missing`, "INVALID_PET_PACKAGE", 422);
    }
  }
  let initialPathStats: fs.Stats;
  let realRoot: string;
  let initialRealFile: string;
  try {
    initialPathStats = fs.lstatSync(candidate);
    realRoot = fs.realpathSync(root);
    initialRealFile = fs.realpathSync(candidate);
  } catch {
    throw new CompanionPetError(`${label} is missing`, "INVALID_PET_PACKAGE", 422);
  }
  if (!initialPathStats.isFile() || initialPathStats.isSymbolicLink()) {
    throw new CompanionPetError(`${label} must be a regular file`, "PET_ACCESS_DENIED", 403);
  }
  if (!isContainedPath(realRoot, initialRealFile)) {
    throw new CompanionPetError(`${label} escapes its pet folder`, "PET_ACCESS_DENIED", 403);
  }
  if (initialPathStats.size <= 0 || initialPathStats.size > maxBytes) {
    throw new CompanionPetError(`${label} exceeds its allowed size`, "PET_TOO_LARGE", 413);
  }

  // Electron's ASAR layer reports virtual entry metadata for lstat(), while
  // fstat() observes the backing archive descriptor. Their inode/size values
  // therefore cannot pass the identity checks below. Piora-bundled pets are
  // immutable, checksum-verified release inputs, so read those entries only
  // after the same containment, symlink, type, and size checks above. Imported
  // or Codex-owned pets continue through the descriptor race defenses below.
  if (immutableBundledResource) {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(candidate);
    } catch {
      throw new CompanionPetError(`${label} could not be read`, "PET_ACCESS_DENIED", 403);
    }
    if (bytes.byteLength !== initialPathStats.size || bytes.byteLength > maxBytes) {
      throw new CompanionPetError(`${label} changed while being read`, "INVALID_PET_PACKAGE", 422);
    }
    return bytes;
  }

  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  let descriptor: number;
  try {
    descriptor = fs.openSync(candidate, fs.constants.O_RDONLY | noFollow);
  } catch {
    throw new CompanionPetError(`${label} could not be opened safely`, "PET_ACCESS_DENIED", 403);
  }

  try {
    const initialDescriptorStats = fs.fstatSync(descriptor);
    if (initialDescriptorStats.size <= 0 || initialDescriptorStats.size > maxBytes) {
      throw new CompanionPetError(`${label} exceeds its allowed size`, "PET_TOO_LARGE", 413);
    }
    let openedRealFile: string;
    let openedPathStats: fs.Stats;
    try {
      openedRealFile = fs.realpathSync(candidate);
      openedPathStats = fs.lstatSync(candidate);
    } catch {
      throw new CompanionPetError(`${label} changed while being opened`, "PET_ACCESS_DENIED", 403);
    }
    if (
      !initialDescriptorStats.isFile()
      || !hasSameFileIdentity(initialPathStats, initialDescriptorStats)
      || initialPathStats.size !== initialDescriptorStats.size
      || initialPathStats.mtimeMs !== initialDescriptorStats.mtimeMs
      || !hasSameFileIdentity(openedPathStats, initialDescriptorStats)
      || openedPathStats.isSymbolicLink()
      || !isContainedPath(realRoot, openedRealFile)
      || !hasSameResolvedPath(initialRealFile, openedRealFile)
    ) {
      throw new CompanionPetError(`${label} changed while being opened`, "PET_ACCESS_DENIED", 403);
    }

    const buffer = Buffer.allocUnsafe(initialDescriptorStats.size + 1);
    let total = 0;
    while (total < buffer.byteLength) {
      const count = fs.readSync(
        descriptor,
        buffer,
        total,
        buffer.byteLength - total,
        null,
      );
      if (count === 0) break;
      total += count;
    }

    const finalDescriptorStats = fs.fstatSync(descriptor);
    let finalPathStats: fs.Stats;
    let finalRealFile: string;
    try {
      finalPathStats = fs.lstatSync(candidate);
      finalRealFile = fs.realpathSync(candidate);
    } catch {
      throw new CompanionPetError(`${label} changed while being read`, "PET_ACCESS_DENIED", 403);
    }
    if (
      total !== initialDescriptorStats.size
      || total > maxBytes
      || finalDescriptorStats.size !== initialDescriptorStats.size
      || finalDescriptorStats.mtimeMs !== initialDescriptorStats.mtimeMs
      || !hasSameFileIdentity(initialDescriptorStats, finalDescriptorStats)
      || !hasSameFileIdentity(finalPathStats, finalDescriptorStats)
      || finalPathStats.isSymbolicLink()
      || !isContainedPath(realRoot, finalRealFile)
      || !hasSameResolvedPath(initialRealFile, finalRealFile)
    ) {
      throw new CompanionPetError(`${label} changed while being read`, "INVALID_PET_PACKAGE", 422);
    }
    return Buffer.from(buffer.subarray(0, total));
  } finally {
    fs.closeSync(descriptor);
  }
}

export function validatePetPackage(
  root: string,
  id: string,
  source: "codex" | "piora",
  sourceKind: CompanionPetSourceKind,
  installed: boolean,
  manifestFileName = "pet.json",
): ValidatedPetPackage {
  requireValidPetId(id);
  let rootPathStats: fs.Stats;
  let rootTargetStats: fs.Stats;
  let rootReal: string;
  try {
    rootPathStats = fs.lstatSync(root);
    rootTargetStats = fs.statSync(root);
    rootReal = fs.realpathSync(root);
  } catch {
    throw new CompanionPetError("Pet data directory was not found", "PET_NOT_FOUND", 404);
  }
  if (!rootTargetStats.isDirectory()) {
    throw new CompanionPetError("Pet data root is not a directory", "PET_ACCESS_DENIED", 403);
  }
  if ((sourceKind === "piora-installed" || sourceKind === "piora-bundled") && rootPathStats.isSymbolicLink()) {
    throw new CompanionPetError(
      "Installed pet data root must not be a symbolic link",
      "PET_ACCESS_DENIED",
      403,
    );
  }
  const petDirectory = path.join(rootReal, id);
  let directoryStats: fs.Stats;
  try {
    directoryStats = fs.lstatSync(petDirectory);
  } catch {
    throw new CompanionPetError("Pet package was not found", "PET_NOT_FOUND", 404);
  }
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new CompanionPetError("Pet package must be a regular directory", "PET_ACCESS_DENIED", 403);
  }
  const realPetDirectory = fs.realpathSync(petDirectory);
  if (!isContainedPath(rootReal, realPetDirectory)) {
    throw new CompanionPetError("Pet package escapes its data directory", "PET_ACCESS_DENIED", 403);
  }

  const manifestBytes = readBoundedRegularFile(
    realPetDirectory,
    manifestFileName,
    sourceKind === "piora-installed" || sourceKind === "piora-bundled"
      ? PET_INSTALLED_MANIFEST_MAX_BYTES
      : PET_MANIFEST_MAX_BYTES,
    manifestFileName,
    sourceKind === "piora-bundled",
  );
  let parsed: unknown;
  try {
    const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes);
    parsed = JSON.parse(manifestText);
  } catch {
    throw new CompanionPetError(`${manifestFileName} is invalid JSON`, "INVALID_PET_PACKAGE", 422);
  }
  const manifest = normalizePetManifest(parsed, id);
  const sourceSpritesheet = normalizeSpritesheetSourcePath(
    isPlainRecord(parsed) ? parsed.spritesheetPath : undefined,
  );
  const spritesheetBytes = readBoundedRegularFile(
    realPetDirectory,
    sourceSpritesheet.relativePath,
    PET_SPRITESHEET_MAX_BYTES,
    "spritesheet",
    sourceKind === "piora-bundled",
  );
  const inspection = inspectPetSpritesheetBytes(spritesheetBytes, sourceSpritesheet.installedName);
  assertAtlasGeometry(inspection, manifest);

  return {
    manifest,
    pet: petFromManifest(manifest, source, sourceKind, installed),
    spritesheetBytes,
    mimeType: inspection.mimeType,
    sourceKind,
  };
}

export function validateBuiltinPet(
  root: string,
  entry: CodexBuiltinPetCatalogEntry,
  installed: boolean,
): ValidatedPetPackage {
  const manifest = normalizePetManifest({
    id: entry.id,
    displayName: entry.displayName,
    description: entry.description,
    spritesheetPath: entry.spritesheetFile,
  }, entry.id);
  const spritesheetBytes = readBoundedRegularFile(
    root,
    entry.spritesheetFile,
    PET_SPRITESHEET_MAX_BYTES,
    "spritesheet",
  );
  const inspection = inspectPetSpritesheetBytes(spritesheetBytes, "spritesheet.webp");
  assertAtlasGeometry(inspection, manifest);
  const sourceKind: CompanionPetSourceKind = "codex-builtin-cache";
  return {
    manifest,
    pet: petFromManifest(manifest, "codex", sourceKind, installed),
    spritesheetBytes,
    mimeType: inspection.mimeType,
    sourceKind,
  };
}

function getCodexHomeDirectory(
  environment: CompanionPetEnvironment = process.env,
): string {
  const configured = environment.CODEX_HOME?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(getRuntimeHomeDirectory(environment), ".codex");
}

export function getCodexPetsDirectory(
  environment: CompanionPetEnvironment = process.env,
): string {
  return path.join(getCodexHomeDirectory(environment), "pets");
}

export function getCodexLegacyAvatarsDirectory(
  environment: CompanionPetEnvironment = process.env,
): string {
  return path.join(getCodexHomeDirectory(environment), "avatars");
}

export function getCodexBuiltinPetsAssetsDirectory(
  environment: CompanionPetEnvironment = process.env,
): string {
  return path.join(getCodexHomeDirectory(environment), "cache", "tui-pets", "v1", "assets");
}

export function getPioraPetsDirectory(
  environment: CompanionPetEnvironment = process.env,
): string {
  return path.join(getRuntimeAgentDataDirectory(environment), "piora", "pets");
}

export function getBundledPioraPetsDirectory(
  environment: CompanionPetEnvironment = process.env,
): string {
  return path.join(firstPartyRuntimeRoot(environment), "public", "companion-pets", "bundled");
}

export function syncFile(file: string): void {
  // Windows rejects FlushFileBuffers for a read-only handle. Open the freshly
  // written staging file read/write so fsync works on every supported OS.
  const descriptor = fs.openSync(file, "r+");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function inspectReplaceableDirectory(directory: string): fs.Stats | null {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new CompanionPetError(
      "Installed pet destination could not be inspected",
      "PET_ACCESS_DENIED",
      403,
    );
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new CompanionPetError(
      "Installed pet destination is not a regular directory",
      "PET_ACCESS_DENIED",
      403,
    );
  }
  return stats;
}

export function assertDirectorySnapshot(
  directory: string,
  expected: fs.Stats | null,
  label: string,
): fs.Stats | null {
  const current = inspectReplaceableDirectory(directory);
  if (
    (expected === null && current !== null)
    || (expected !== null && (current === null || !hasSameFileIdentity(expected, current)))
  ) {
    throw new CompanionPetError(`${label} changed during import`, "PET_ACCESS_DENIED", 403);
  }
  return current;
}

export function removeOwnedDirectory(directory: string, expected: fs.Stats): void {
  let current: fs.Stats;
  try {
    current = fs.lstatSync(directory);
  } catch {
    return;
  }
  if (
    !current.isDirectory()
    || current.isSymbolicLink()
    || !hasSameFileIdentity(expected, current)
  ) {
    return;
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
