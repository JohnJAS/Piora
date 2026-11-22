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

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { listCompanionModels } from "../companion-models";
import {
  CODEX_BUILTIN_PET_CATALOG,
  CODEX_SOURCE_KINDS,
  CompanionPetError,
  isPlainRecord,
  isValidPetId,
  normalizePetManifest,
  normalizeSpritesheetSourcePath,
  PET_ARCHIVE_MAX_BYTES,
  PET_ARCHIVE_MAX_ENTRIES,
  PET_INSTALLED_MANIFEST_MAX_BYTES,
  PET_MANIFEST_MAX_BYTES,
  PET_SPRITESHEET_MAX_BYTES,
  petFromManifest,
  requireValidPetId,
  type CodexPetSourceKind,
  type CompanionPet,
  type CompanionPetDiagnostic,
  type CompanionPetEnvironment,
  type CompanionPetSourceKind,
  type CompanionPetsResponse,
  type NormalizedPetManifest,
  type ValidatedPetPackage,
} from "./pet-manifest";
import {
  assertDirectorySnapshot,
  getBundledPioraPetsDirectory,
  getCodexBuiltinPetsAssetsDirectory,
  getCodexLegacyAvatarsDirectory,
  getCodexPetsDirectory,
  getPioraPetsDirectory,
  hasSameFileIdentity,
  inspectReplaceableDirectory,
  isContainedPath,
  readBoundedRegularFile,
  removeOwnedDirectory,
  syncFile,
  validateBuiltinPet,
  validatePetPackage,
} from "./pet-fs";
import { assertAtlasGeometry, inspectPetSpritesheetBytes } from "./sprite-inspector";

function listPetPackages(
  root: string,
  sourceKind: CompanionPetSourceKind,
  installedSourceKeys: ReadonlySet<string>,
  manifestFileName = "pet.json",
): { pets: CompanionPet[]; diagnostics: CompanionPetDiagnostic[]; available: boolean } {
  const source = sourceKind === "piora-installed" || sourceKind === "piora-bundled" ? "piora" : "codex";
  const scope = source === "codex" ? "source" : "installed";
  let rootPathStats: fs.Stats;
  let rootStats: fs.Stats;
  try {
    rootPathStats = fs.lstatSync(root);
    rootStats = fs.statSync(root);
  } catch {
    return { pets: [], diagnostics: [], available: false };
  }
  if ((sourceKind === "piora-installed" || sourceKind === "piora-bundled") && rootPathStats.isSymbolicLink()) {
    return {
      pets: [],
      diagnostics: [{ scope, message: "Installed pet root must not be a symbolic link" }],
      available: false,
    };
  }
  if (!rootStats.isDirectory()) {
    return {
      pets: [],
      diagnostics: [{ scope, message: "Pet root is not a directory" }],
      available: false,
    };
  }

  const pets: CompanionPet[] = [];
  const diagnostics: CompanionPetDiagnostic[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return {
      pets: [],
      diagnostics: [{ scope, message: "Pet root could not be read" }],
      available: false,
    };
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidPetId(entry.name)) continue;
    try {
      const validated = validatePetPackage(
        root,
        entry.name,
        source,
        sourceKind,
        sourceKind === "piora-installed" || sourceKind === "piora-bundled"
          || installedSourceKeys.has(`${sourceKind}:${entry.name}`)
          || installedSourceKeys.has(`*:${entry.name}`),
        manifestFileName,
      );
      pets.push(validated.pet);
    } catch (error) {
      diagnostics.push({
        scope,
        id: entry.name,
        message: error instanceof CompanionPetError ? error.message : "Pet package could not be read",
      });
    }
  }
  pets.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { pets, diagnostics, available: true };
}

function listBuiltinPets(
  root: string,
  installedSourceKeys: ReadonlySet<string>,
): { pets: CompanionPet[]; diagnostics: CompanionPetDiagnostic[]; available: boolean } {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(root);
  } catch {
    return { pets: [], diagnostics: [], available: false };
  }
  if (!stats.isDirectory()) {
    return {
      pets: [],
      diagnostics: [{ scope: "source", message: "Codex built-in pet cache is not a directory" }],
      available: false,
    };
  }
  const pets: CompanionPet[] = [];
  const diagnostics: CompanionPetDiagnostic[] = [];
  for (const entry of CODEX_BUILTIN_PET_CATALOG) {
    const file = path.join(root, entry.spritesheetFile);
    if (!fs.existsSync(file)) continue;
    try {
      pets.push(validateBuiltinPet(
        root,
        entry,
        installedSourceKeys.has(`codex-builtin-cache:${entry.id}`)
          || installedSourceKeys.has(`*:${entry.id}`),
      ).pet);
    } catch (error) {
      diagnostics.push({
        scope: "source",
        id: entry.id,
        message: error instanceof CompanionPetError ? error.message : "Built-in pet could not be read",
      });
    }
  }
  return { pets, diagnostics, available: true };
}

export function listCompanionPets(
  environment: CompanionPetEnvironment = process.env,
): CompanionPetsResponse {
  const bundledResult = listPetPackages(
    getBundledPioraPetsDirectory(environment),
    "piora-bundled",
    new Set(),
  );
  const installedResult = listPetPackages(
    getPioraPetsDirectory(environment),
    "piora-installed",
    new Set(),
  );
  const installedById = new Map(bundledResult.pets.map((pet) => [pet.id, pet]));
  for (const pet of installedResult.pets) installedById.set(pet.id, pet);
  const modelsResult = listCompanionModels(environment);
  for (const pet of modelsResult.pets) {
    if (!installedById.has(pet.id)) installedById.set(pet.id, pet);
  }
  const installed = [...installedById.values()].sort((left, right) => (
    left.displayName.localeCompare(right.displayName)
  ));
  const installedSourceKeys = new Set(installed.map((pet) => (
    `${pet.origin ?? "*"}:${pet.id}`
  )));
  const builtinResult = listBuiltinPets(
    getCodexBuiltinPetsAssetsDirectory(environment),
    installedSourceKeys,
  );
  const customResult = listPetPackages(
    getCodexPetsDirectory(environment),
    "codex-custom",
    installedSourceKeys,
  );
  const legacyResult = listPetPackages(
    getCodexLegacyAvatarsDirectory(environment),
    "codex-legacy-avatar",
    installedSourceKeys,
    "avatar.json",
  );
  const sources = [
    ...builtinResult.pets,
    ...customResult.pets,
    ...legacyResult.pets,
  ].sort((left, right) => left.displayName.localeCompare(right.displayName));
  return {
    codexSourceAvailable: builtinResult.available || customResult.available || legacyResult.available,
    sources,
    installed,
    diagnostics: [
      ...builtinResult.diagnostics,
      ...customResult.diagnostics,
      ...legacyResult.diagnostics,
      ...bundledResult.diagnostics,
      ...installedResult.diagnostics,
      ...modelsResult.diagnostics,
    ],
  };
}

function loadCodexSourcePet(
  id: string,
  environment: CompanionPetEnvironment,
  requestedSourceKind?: CodexPetSourceKind,
): ValidatedPetPackage {
  if (requestedSourceKind !== undefined && !CODEX_SOURCE_KINDS.has(requestedSourceKind)) {
    throw new CompanionPetError("Pet source is invalid", "INVALID_PET_SOURCE", 400);
  }
  const trySource = (sourceKind: CodexPetSourceKind): ValidatedPetPackage | null => {
    if (sourceKind === "codex-builtin-cache") {
      const catalogEntry = CODEX_BUILTIN_PET_CATALOG.find((entry) => entry.id === id);
      if (!catalogEntry) return null;
      const root = getCodexBuiltinPetsAssetsDirectory(environment);
      if (!fs.existsSync(path.join(root, catalogEntry.spritesheetFile))) return null;
      return validateBuiltinPet(root, catalogEntry, false);
    }
    const root = sourceKind === "codex-custom"
      ? getCodexPetsDirectory(environment)
      : getCodexLegacyAvatarsDirectory(environment);
    const manifestFileName = sourceKind === "codex-custom" ? "pet.json" : "avatar.json";
    if (!fs.existsSync(path.join(root, id, manifestFileName))) return null;
    return validatePetPackage(root, id, "codex", sourceKind, false, manifestFileName);
  };

  if (requestedSourceKind) {
    const source = trySource(requestedSourceKind);
    if (source) return source;
    throw new CompanionPetError("Codex pet source was not found", "PET_NOT_FOUND", 404);
  }

  // Preserve the old API's custom-pet behavior when callers have not yet
  // adopted sourceKind, then fall back to other local Codex sources.
  for (const sourceKind of [
    "codex-custom",
    "codex-builtin-cache",
    "codex-legacy-avatar",
  ] as const) {
    const source = trySource(sourceKind);
    if (source) return source;
  }
  throw new CompanionPetError("Codex pet source was not found", "PET_NOT_FOUND", 404);
}

export function readCodexPetSpritesheet(
  id: string,
  sourceKind: CodexPetSourceKind,
  environment: CompanionPetEnvironment = process.env,
): { bytes: Buffer; mimeType: "image/png" | "image/webp"; pet: CompanionPet } {
  const validated = loadCodexSourcePet(id, environment, sourceKind);
  return {
    bytes: validated.spritesheetBytes,
    mimeType: validated.mimeType,
    pet: validated.pet,
  };
}

function installValidatedPet(
  source: ValidatedPetPackage,
  environment: CompanionPetEnvironment = process.env,
): { pet: CompanionPet; replaced: boolean } {
  const id = source.manifest.id;
  requireValidPetId(id);
  // validatePetPackage returns the exact bytes read from its verified file
  // descriptor, so no attacker-controlled pathname is reopened for the copy.
  const spritesheetBytes = source.spritesheetBytes;

  const configuredInstallRoot = getPioraPetsDirectory(environment);
  try {
    fs.mkdirSync(configuredInstallRoot, { recursive: true, mode: 0o700 });
  } catch {
    throw new CompanionPetError("Pet install directory could not be created", "PET_IMPORT_FAILED", 500);
  }
  let installRootStats: fs.Stats;
  let installRoot: string;
  try {
    installRootStats = fs.lstatSync(configuredInstallRoot);
    installRoot = fs.realpathSync(configuredInstallRoot);
  } catch {
    throw new CompanionPetError("Pet install directory could not be opened", "PET_IMPORT_FAILED", 500);
  }
  if (!installRootStats.isDirectory() || installRootStats.isSymbolicLink()) {
    throw new CompanionPetError(
      "Pet install directory must be a regular directory",
      "PET_ACCESS_DENIED",
      403,
    );
  }
  const destination = path.join(installRoot, id);
  if (!isContainedPath(installRoot, destination)) {
    throw new CompanionPetError("Invalid pet destination", "PET_ACCESS_DENIED", 403);
  }
  const destinationSnapshot = inspectReplaceableDirectory(destination);

  const staging = path.join(installRoot, `.import-${id}-${randomUUID()}`);
  const backup = path.join(installRoot, `.backup-${id}-${randomUUID()}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  const stagingSnapshot = fs.lstatSync(staging);
  let movedExisting = false;
  let installed = false;
  let stagedPet: CompanionPet | null = null;
  const replaced = destinationSnapshot !== null;
  try {
    const manifestFile = path.join(staging, "pet.json");
    const spritesheetFile = path.join(staging, source.manifest.spritesheetPath);
    const installedManifest: NormalizedPetManifest = {
      ...source.manifest,
      origin: source.sourceKind as CodexPetSourceKind,
    };
    const installedManifestPayload = `${JSON.stringify(installedManifest)}\n`;
    if (Buffer.byteLength(installedManifestPayload, "utf8") > PET_INSTALLED_MANIFEST_MAX_BYTES) {
      throw new CompanionPetError(
        "Normalized pet manifest is too large",
        "PET_TOO_LARGE",
        413,
      );
    }
    fs.writeFileSync(manifestFile, installedManifestPayload, { flag: "wx", mode: 0o600 });
    fs.writeFileSync(spritesheetFile, spritesheetBytes, { flag: "wx", mode: 0o600 });
    syncFile(manifestFile);
    syncFile(spritesheetFile);

    const stagedManifestBytes = readBoundedRegularFile(
      staging,
      "pet.json",
      PET_INSTALLED_MANIFEST_MAX_BYTES,
      "pet.json",
    );
    let stagedManifestValue: unknown;
    try {
      stagedManifestValue = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(stagedManifestBytes),
      );
    } catch {
      throw new CompanionPetError("Staged pet manifest is invalid", "PET_IMPORT_FAILED", 500);
    }
    const stagedManifest = normalizePetManifest(stagedManifestValue, id);
    const stagedSpritesheetBytes = readBoundedRegularFile(
      staging,
      stagedManifest.spritesheetPath,
      PET_SPRITESHEET_MAX_BYTES,
      "spritesheet",
    );
    const stagedInspection = inspectPetSpritesheetBytes(
      stagedSpritesheetBytes,
      stagedManifest.spritesheetPath,
    );
    assertAtlasGeometry(stagedInspection, stagedManifest);
    if (!stagedSpritesheetBytes.equals(spritesheetBytes)) {
      throw new CompanionPetError("Staged spritesheet verification failed", "PET_IMPORT_FAILED", 500);
    }
    stagedPet = petFromManifest(stagedManifest, "piora", "piora-installed", true);

    assertDirectorySnapshot(destination, destinationSnapshot, "Installed pet destination");
    if (destinationSnapshot) {
      fs.renameSync(destination, backup);
      movedExisting = true;
      assertDirectorySnapshot(backup, destinationSnapshot, "Installed pet backup");
    }
    fs.renameSync(staging, destination);
    assertDirectorySnapshot(destination, stagingSnapshot, "Installed pet destination");
    installed = true;
  } catch (error) {
    const currentDestination = inspectReplaceableDirectory(destination);
    const currentBackup = inspectReplaceableDirectory(backup);
    if (
      !installed
      && movedExisting
      && currentDestination === null
      && destinationSnapshot
      && currentBackup
      && hasSameFileIdentity(destinationSnapshot, currentBackup)
    ) {
      try {
        fs.renameSync(backup, destination);
        movedExisting = false;
      } catch {
        // Keep the backup for manual recovery rather than deleting user data.
      }
    }
    if (error instanceof CompanionPetError) throw error;
    throw new CompanionPetError("Pet import failed", "PET_IMPORT_FAILED", 500);
  } finally {
    try {
      removeOwnedDirectory(staging, stagingSnapshot);
    } catch {
      // Safe dot-prefixed staging data can be retried on a later cleanup.
    }
    // Once the new directory is in place, a failed backup cleanup must not
    // turn a successful atomic replacement into an API failure.
    if (installed && destinationSnapshot) {
      try {
        removeOwnedDirectory(backup, destinationSnapshot);
      } catch {
        // A dot-prefixed recovery copy is safer than deleting data after an
        // antivirus/indexer temporarily holds a file open on Windows.
      }
    }
  }

  if (!stagedPet) {
    throw new CompanionPetError("Pet import failed", "PET_IMPORT_FAILED", 500);
  }
  return { pet: stagedPet, replaced };
}

export function importCodexPet(
  id: string,
  environment: CompanionPetEnvironment = process.env,
  sourceKind?: CodexPetSourceKind,
): { pet: CompanionPet; replaced: boolean } {
  requireValidPetId(id);
  return installValidatedPet(loadCodexSourcePet(id, environment, sourceKind), environment);
}

type SizedZipObject = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: number };
  unsafeOriginalName?: string;
};

function assertSafeArchiveEntry(entry: SizedZipObject): void {
  const originalName = entry.unsafeOriginalName ?? entry.name;
  const normalized = originalName.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (
    originalName.includes("\\")
    || normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new CompanionPetError("Pet archive contains an unsafe path", "INVALID_PET_PACKAGE", 422);
  }
}

async function readArchiveEntryWithinLimit(
  entry: SizedZipObject,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const declaredSize = entry._data?.uncompressedSize;
  if (typeof declaredSize === "number" && declaredSize > maxBytes) {
    throw new CompanionPetError(`${label} is too large`, "PET_TOO_LARGE", 413);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolveRead, rejectRead) => {
    const stream = entry.nodeStream("nodebuffer");
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      stream.pause();
      rejectRead(error);
    };
    stream.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        fail(new CompanionPetError(`${label} is too large`, "PET_TOO_LARGE", 413));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    stream.on("error", () => fail(
      new CompanionPetError(`Could not read ${label}`, "INVALID_PET_PACKAGE", 422),
    ));
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolveRead();
    });
    stream.resume();
  });
  return Buffer.concat(chunks, total);
}

function archiveFallbackPetId(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName))
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 64);
  return isValidPetId(base) ? base : `pet-${randomUUID().slice(0, 8)}`;
}

export async function importCodexPetArchive(
  archiveBytes: Buffer,
  fileName: string,
  environment: CompanionPetEnvironment = process.env,
): Promise<{ pet: CompanionPet; replaced: boolean }> {
  if (archiveBytes.byteLength === 0) {
    throw new CompanionPetError("Pet archive is empty", "INVALID_PET_PACKAGE", 422);
  }
  if (archiveBytes.byteLength > PET_ARCHIVE_MAX_BYTES) {
    throw new CompanionPetError("Pet archive is too large", "PET_TOO_LARGE", 413);
  }

  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(archiveBytes, { createFolders: false });
  } catch {
    throw new CompanionPetError("Pet archive is not a valid ZIP file", "INVALID_PET_PACKAGE", 422);
  }
  const entries = Object.values(archive.files) as SizedZipObject[];
  if (entries.length === 0 || entries.length > PET_ARCHIVE_MAX_ENTRIES) {
    throw new CompanionPetError("Pet archive contains too many entries", "INVALID_PET_PACKAGE", 422);
  }
  entries.forEach(assertSafeArchiveEntry);

  const manifestCandidates = entries
    .filter((entry) => !entry.dir && /(^|\/)(pet|avatar)\.json$/i.test(entry.name))
    .sort((left, right) => left.name.split("/").length - right.name.split("/").length);
  const manifestEntry = manifestCandidates[0];
  if (!manifestEntry) {
    throw new CompanionPetError("Pet archive must contain pet.json", "INVALID_PET_PACKAGE", 422);
  }
  const manifestBytes = await readArchiveEntryWithinLimit(
    manifestEntry,
    PET_MANIFEST_MAX_BYTES,
    path.basename(manifestEntry.name),
  );
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch {
    throw new CompanionPetError("Pet manifest is invalid JSON", "INVALID_PET_PACKAGE", 422);
  }
  const manifest = normalizePetManifest(parsedManifest, archiveFallbackPetId(fileName));
  const sourceSpritesheet = normalizeSpritesheetSourcePath(
    isPlainRecord(parsedManifest) ? parsedManifest.spritesheetPath : undefined,
  );
  const manifestDirectory = path.posix.dirname(manifestEntry.name);
  const sourcePath = manifestDirectory === "."
    ? sourceSpritesheet.relativePath
    : `${manifestDirectory}/${sourceSpritesheet.relativePath}`;
  const spritesheetEntry = entries.find((entry) => !entry.dir && entry.name === sourcePath);
  if (!spritesheetEntry) {
    throw new CompanionPetError("Pet archive is missing its spritesheet", "INVALID_PET_PACKAGE", 422);
  }
  const spritesheetBytes = await readArchiveEntryWithinLimit(
    spritesheetEntry,
    PET_SPRITESHEET_MAX_BYTES,
    "spritesheet",
  );
  const inspection = inspectPetSpritesheetBytes(spritesheetBytes, sourceSpritesheet.installedName);
  assertAtlasGeometry(inspection, manifest);
  const sourceKind: CodexPetSourceKind = manifestEntry.name.toLowerCase().endsWith("avatar.json")
    ? "codex-legacy-avatar"
    : "codex-custom";
  return installValidatedPet({
    manifest,
    pet: petFromManifest(manifest, "codex", sourceKind, false),
    spritesheetBytes,
    mimeType: inspection.mimeType,
    sourceKind,
  }, environment);
}

export function readInstalledPetSpritesheet(
  id: string,
  environment: CompanionPetEnvironment = process.env,
): { bytes: Buffer; mimeType: "image/png" | "image/webp"; pet: CompanionPet } {
  requireValidPetId(id);
  const installRoot = getPioraPetsDirectory(environment);
  if (!fs.existsSync(installRoot)) {
    throw new CompanionPetError("Installed pet was not found", "PET_NOT_FOUND", 404);
  }
  const validated = validatePetPackage(
    installRoot,
    id,
    "piora",
    "piora-installed",
    true,
  );
  return {
    bytes: validated.spritesheetBytes,
    mimeType: validated.mimeType,
    pet: validated.pet,
  };
}
