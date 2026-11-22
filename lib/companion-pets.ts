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

// Public facade barrel for companion pet validation, spritesheet inspection, and installation.
// Implementation is modularized under lib/companion/.
export {
  CompanionPetError,
  getCodexPetAnimationStates,
  isValidPetId,
  normalizePetManifest,
  PET_ARCHIVE_MAX_BYTES,
  PET_ARCHIVE_REQUEST_MAX_BYTES,
  PET_IMPORT_REQUEST_MAX_BYTES,
  PET_INSTALLED_MANIFEST_MAX_BYTES,
  PET_MANIFEST_MAX_BYTES,
  PET_SPRITESHEET_MAX_BYTES,
  type CodexPetSourceKind,
  type CompanionPet,
  type CompanionPetDiagnostic,
  type CompanionPetEnvironment,
  type CompanionPetFrame,
  type CompanionPetSourceKind,
  type CompanionPetsResponse,
  type NormalizedPetAnimation,
  type NormalizedPetManifest,
  type PetAnimationState,
  type PetAnimationStateId,
} from "./companion/pet-manifest";
export { inspectPetSpritesheetBytes } from "./companion/sprite-inspector";
export {
  getBundledPioraPetsDirectory,
  getCodexBuiltinPetsAssetsDirectory,
  getCodexLegacyAvatarsDirectory,
  getCodexPetsDirectory,
  getPioraPetsDirectory,
} from "./companion/pet-fs";
export {
  importCodexPet,
  importCodexPetArchive,
  listCompanionPets,
  readCodexPetSpritesheet,
  readInstalledPetSpritesheet,
} from "./companion/pet-installer";
