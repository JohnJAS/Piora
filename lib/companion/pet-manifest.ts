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

import path from "node:path";
import type { RuntimeHomeEnvironment } from "../runtime-home";
import { BUNDLED_COMPANION_PETS_PUBLIC_PATH } from "../companion-store";
import type { CompanionModel3D } from "../companion-models";

export const PET_MANIFEST_MAX_BYTES = 64 * 1024;
export const PET_INSTALLED_MANIFEST_MAX_BYTES = 256 * 1024;
export const PET_SPRITESHEET_MAX_BYTES = 16 * 1024 * 1024;
export const PET_IMPORT_REQUEST_MAX_BYTES = 4 * 1024;
export const PET_ARCHIVE_MAX_BYTES = 20 * 1024 * 1024;
export const PET_ARCHIVE_REQUEST_MAX_BYTES = PET_ARCHIVE_MAX_BYTES + 1024 * 1024;
export const PET_ARCHIVE_MAX_ENTRIES = 64;

const ATLAS_WIDTH = 1536;
const ATLAS_HEIGHT_V1 = 1872;
const ATLAS_HEIGHT_V2 = 2288;
const FRAME_WIDTH = 192;
const FRAME_HEIGHT = 208;
const DEFAULT_COLUMNS = 8;
const DEFAULT_ROWS_V1 = 9;
const DEFAULT_ROWS_V2 = 11;
const MAX_PET_FRAMES = 256;
const MAX_ANIMATIONS = 64;
const MAX_ANIMATION_FRAMES = 1024;
const MAX_ANIMATION_FPS = 60;
const MAX_TIMER_DURATION_MS = 2_147_483_647;
export const MAX_IMAGE_CONTAINER_CHUNKS = 8_192;
const SAFE_PET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const WINDOWS_DEVICE_PET_ID = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
export const ALLOWED_SPRITESHEETS = new Set(["spritesheet.webp", "spritesheet.png"]);

export interface CodexBuiltinPetCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  spritesheetFile: string;
}

/** Current OpenAI Codex TUI v1 catalog; files are discovered locally only. */
export const CODEX_BUILTIN_PET_CATALOG: readonly CodexBuiltinPetCatalogEntry[] = [
  { id: "codex", displayName: "Codex", description: "The original Codex companion", spritesheetFile: "codex-spritesheet-v4.webp" },
  { id: "dewey", displayName: "Dewey", description: "A tidy duck for calm workspace days", spritesheetFile: "dewey-spritesheet-v4.webp" },
  { id: "fireball", displayName: "Fireball", description: "Hot path energy for fast iteration", spritesheetFile: "fireball-spritesheet-v4.webp" },
  { id: "rocky", displayName: "Rocky", description: "A steady rock when the diff gets large", spritesheetFile: "rocky-spritesheet-v4.webp" },
  { id: "seedy", displayName: "Seedy", description: "Small green shoots for new ideas", spritesheetFile: "seedy-spritesheet-v4.webp" },
  { id: "stacky", displayName: "Stacky", description: "A balanced stack for deep work", spritesheetFile: "stacky-spritesheet-v4.webp" },
  { id: "bsod", displayName: "BSOD", description: "A tiny blue-screen gremlin", spritesheetFile: "bsod-spritesheet-v4.webp" },
  { id: "null-signal", displayName: "Null Signal", description: "Quiet signal from the void", spritesheetFile: "null-signal-spritesheet-v4.webp" },
];

export interface CompanionPetEnvironment extends RuntimeHomeEnvironment {
  CODEX_HOME?: string;
}

export type CompanionPetSourceKind =
  | "codex-builtin-cache"
  | "codex-custom"
  | "codex-legacy-avatar"
  | "piora-bundled"
  | "piora-installed";

export type CodexPetSourceKind = Exclude<CompanionPetSourceKind, "piora-bundled" | "piora-installed">;

export const CODEX_SOURCE_KINDS = new Set<CodexPetSourceKind>([
  "codex-builtin-cache",
  "codex-custom",
  "codex-legacy-avatar",
]);

export type PetAnimationStateId =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review"
  | "look-directions-a"
  | "look-directions-b";

export interface PetAnimationState {
  id: string;
  frameIndices: number[];
  durationsMs: number[];
  loopStart: number | null;
  fallback: string;
  /** Compatibility hints only; frameIndices is the authoritative address. */
  row: number | null;
  frames: number;
  directionsDegrees?: number[];
}

export interface CompanionPetFrame {
  width: number;
  height: number;
  columns: number;
  rows: number;
}

export interface NormalizedPetAnimation {
  frameIndices: number[];
  durationsMs: number[];
  loopStart: number | null;
  fallback: string;
}

export interface CompanionPet {
  model3d?: CompanionModel3D;
  id: string;
  displayName: string;
  description?: string;
  author?: string;
  spriteVersionNumber: 1 | 2;
  spritesheetPath: "spritesheet.webp" | "spritesheet.png";
  atlasUrl: string | null;
  width: number;
  height: number;
  frame: CompanionPetFrame;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  states: PetAnimationState[];
  source: "codex" | "piora";
  sourceKind: CompanionPetSourceKind;
  sourceKey: string;
  origin?: CodexPetSourceKind;
  installed: boolean;
}

export interface CompanionPetDiagnostic {
  scope: "source" | "installed";
  id?: string;
  message: string;
}

export interface CompanionPetsResponse {
  codexSourceAvailable: boolean;
  sources: CompanionPet[];
  installed: CompanionPet[];
  diagnostics: CompanionPetDiagnostic[];
}

export interface NormalizedPetManifest {
  schemaVersion: 1;
  id: string;
  displayName: string;
  description?: string;
  author?: string;
  spriteVersionNumber: 1 | 2;
  spritesheetPath: "spritesheet.webp" | "spritesheet.png";
  frame: CompanionPetFrame;
  animations: Record<string, NormalizedPetAnimation>;
  origin?: CodexPetSourceKind;
}

export class CompanionPetError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_PET_ID"
      | "INVALID_PET_SOURCE"
      | "PET_NOT_FOUND"
      | "INVALID_PET_PACKAGE"
      | "PET_TOO_LARGE"
      | "PET_ACCESS_DENIED"
      | "PET_IMPORT_FAILED",
    readonly status: number,
  ) {
    super(message);
    this.name = "CompanionPetError";
  }
}

export interface SpriteInspection {
  mimeType: "image/png" | "image/webp";
  width: number;
  height: number;
}

export interface ValidatedPetPackage {
  manifest: NormalizedPetManifest;
  pet: CompanionPet;
  spritesheetBytes: Buffer;
  mimeType: "image/png" | "image/webp";
  sourceKind: CompanionPetSourceKind;
}

export interface SafeSpritesheetPath {
  relativePath: string;
  installedName: "spritesheet.webp" | "spritesheet.png";
}

const IDLE_FRAME_INDICES = [0, 1, 2, 3, 4, 5];
const IDLE_DURATIONS_MS = [1680, 660, 660, 840, 840, 1920];

function normalizedAnimation(
  frameIndices: number[],
  durationsMs: number[],
  loopStart: number | null,
  fallback = "idle",
): NormalizedPetAnimation {
  return { frameIndices, durationsMs, loopStart, fallback };
}

function repeatedPrimaryAnimation(
  row: number,
  frameCount: number,
  durationMs: number,
  finalDurationMs: number,
): NormalizedPetAnimation {
  const primary = Array.from(
    { length: frameCount },
    (_, column) => row * DEFAULT_COLUMNS + column,
  );
  const primaryDurations = Array.from(
    { length: frameCount },
    (_, index) => index === frameCount - 1 ? finalDurationMs : durationMs,
  );
  return normalizedAnimation(
    [...primary, ...primary, ...primary, ...IDLE_FRAME_INDICES],
    [...primaryDurations, ...primaryDurations, ...primaryDurations, ...IDLE_DURATIONS_MS],
    primary.length * 3,
  );
}

/** Defaults mirrored from Codex's current pet manifest loader. */
function defaultPetAnimations(spriteVersionNumber: 1 | 2): Record<string, NormalizedPetAnimation> {
  const idle = normalizedAnimation([...IDLE_FRAME_INDICES], [...IDLE_DURATIONS_MS], 0);
  const runningRight = repeatedPrimaryAnimation(1, 8, 120, 220);
  const runningLeft = repeatedPrimaryAnimation(2, 8, 120, 220);
  const waving = repeatedPrimaryAnimation(3, 4, 140, 280);
  const jumping = repeatedPrimaryAnimation(4, 5, 140, 280);
  const failed = repeatedPrimaryAnimation(5, 8, 140, 240);
  const waiting = repeatedPrimaryAnimation(6, 6, 150, 260);
  const running = repeatedPrimaryAnimation(7, 6, 120, 220);
  const review = repeatedPrimaryAnimation(8, 6, 150, 280);
  const animations = Object.assign(Object.create(null) as Record<string, NormalizedPetAnimation>, {
    idle,
    "running-right": runningRight,
    "running-left": runningLeft,
    waving,
    jumping,
    failed,
    waiting,
    running,
    review,
    move_right: runningRight,
    move_left: runningLeft,
    wave: waving,
    bounce: jumping,
    sad: failed,
  });
  if (spriteVersionNumber === 2) {
    animations["look-directions-a"] = normalizedAnimation(
      Array.from({ length: 8 }, (_, index) => 72 + index),
      Array.from({ length: 8 }, () => 150),
      0,
    );
    animations["look-directions-b"] = normalizedAnimation(
      Array.from({ length: 8 }, (_, index) => 80 + index),
      Array.from({ length: 8 }, () => 150),
      0,
    );
  }
  return animations;
}

function contiguousRow(frameIndices: readonly number[], columns: number): number | null {
  if (frameIndices.length === 0) return null;
  const first = frameIndices[0];
  const row = Math.floor(first / columns);
  return frameIndices.every(
    (frameIndex, index) => frameIndex === first + index && Math.floor(frameIndex / columns) === row,
  ) ? row : null;
}

function petAnimationStates(
  animations: Readonly<Record<string, NormalizedPetAnimation>>,
  columns: number,
): PetAnimationState[] {
  return Object.entries(animations).map(([id, animation]) => ({
    id,
    frameIndices: [...animation.frameIndices],
    durationsMs: [...animation.durationsMs],
    loopStart: animation.loopStart,
    fallback: animation.fallback,
    row: contiguousRow(animation.frameIndices, columns),
    frames: animation.frameIndices.length,
    ...(id === "look-directions-a" && animation.frameIndices.length === 8
      ? { directionsDegrees: [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5] }
      : id === "look-directions-b" && animation.frameIndices.length === 8
        ? { directionsDegrees: [180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5] }
        : {}),
  }));
}

export function getCodexPetAnimationStates(spriteVersionNumber: 1 | 2): PetAnimationState[] {
  return petAnimationStates(defaultPetAnimations(spriteVersionNumber), DEFAULT_COLUMNS);
}

export function isValidPetId(value: unknown): value is string {
  return typeof value === "string"
    && SAFE_PET_ID.test(value)
    && value !== "."
    && value !== ".."
    && !value.endsWith(".")
    && !WINDOWS_DEVICE_PET_ID.test(value);
}

export function requireValidPetId(value: string): string {
  if (!isValidPetId(value)) {
    throw new CompanionPetError(
      "Pet id must be 1-64 ASCII letters, numbers, dots, underscores, or hyphens",
      "INVALID_PET_ID",
      400,
    );
  }
  return value;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeManifestText(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
): string | undefined {
  if (value === undefined || value === null) {
    if (required) {
      throw new CompanionPetError(`${field} is required`, "INVALID_PET_PACKAGE", 422);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    throw new CompanionPetError(`${field} must be a string`, "INVALID_PET_PACKAGE", 422);
  }
  const text = value.trim();
  if (
    (required && !text)
    || text.length > maxLength
    || /[\u0000-\u001F\u007F-\u009F<>\u2028\u2029\u202A-\u202E\u2066-\u2069]/.test(text)
  ) {
    throw new CompanionPetError(`${field} contains unsafe text`, "INVALID_PET_PACKAGE", 422);
  }
  return text || undefined;
}

export function normalizeSpritesheetSourcePath(value: unknown): SafeSpritesheetPath {
  const text = safeManifestText(value, "spritesheetPath", 240) ?? "spritesheet.webp";
  const portable = text.replaceAll("\\", "/");
  if (
    portable.startsWith("/")
    || /^[A-Za-z]:\//.test(portable)
    || portable.startsWith("//")
  ) {
    throw new CompanionPetError(
      "spritesheetPath must stay inside its pet folder",
      "INVALID_PET_PACKAGE",
      422,
    );
  }
  const segments: string[] = [];
  for (const segment of portable.split("/")) {
    if (segment === ".") continue;
    if (
      !segment
      || segment === ".."
      || segment.length > 120
      || /[\u0000-\u001F\u007F<>:"|?*]/.test(segment)
      || /[. ]$/.test(segment)
      || WINDOWS_DEVICE_PET_ID.test(segment)
    ) {
      throw new CompanionPetError(
        "spritesheetPath contains an unsafe path segment",
        "INVALID_PET_PACKAGE",
        422,
      );
    }
    segments.push(segment);
  }
  if (segments.length === 0 || segments.length > 16) {
    throw new CompanionPetError("spritesheetPath is invalid", "INVALID_PET_PACKAGE", 422);
  }
  const lowerName = segments.at(-1)!.toLowerCase();
  const installedName = lowerName.endsWith(".png")
    ? "spritesheet.png"
    : lowerName.endsWith(".webp")
      ? "spritesheet.webp"
      : null;
  if (!installedName) {
    throw new CompanionPetError(
      "spritesheetPath must name a PNG or WebP file",
      "INVALID_PET_PACKAGE",
      422,
    );
  }
  return { relativePath: path.join(...segments), installedName };
}

function manifestInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new CompanionPetError(`${field} must be a positive integer`, "INVALID_PET_PACKAGE", 422);
  }
  return value as number;
}

function normalizeFrame(
  value: unknown,
  requestedVersion: 1 | 2 | undefined,
): { frame: CompanionPetFrame; spriteVersionNumber: 1 | 2; frameCount: number } {
  let frame: CompanionPetFrame;
  if (value === undefined || value === null) {
    const rows = requestedVersion === 2 ? DEFAULT_ROWS_V2 : DEFAULT_ROWS_V1;
    frame = { width: FRAME_WIDTH, height: FRAME_HEIGHT, columns: DEFAULT_COLUMNS, rows };
  } else {
    if (!isPlainRecord(value)) {
      throw new CompanionPetError("frame must be an object", "INVALID_PET_PACKAGE", 422);
    }
    frame = {
      width: manifestInteger(value.width, "frame.width"),
      height: manifestInteger(value.height, "frame.height"),
      columns: manifestInteger(value.columns, "frame.columns"),
      rows: manifestInteger(value.rows, "frame.rows"),
    };
  }
  const atlasWidth = frame.width * frame.columns;
  const atlasHeight = frame.height * frame.rows;
  const frameCount = frame.columns * frame.rows;
  if (
    !Number.isSafeInteger(atlasWidth)
    || !Number.isSafeInteger(atlasHeight)
    || atlasWidth !== ATLAS_WIDTH
    || (atlasHeight !== ATLAS_HEIGHT_V1 && atlasHeight !== ATLAS_HEIGHT_V2)
  ) {
    throw new CompanionPetError(
      `frame grid must cover exactly ${ATLAS_WIDTH}x${ATLAS_HEIGHT_V1} or ${ATLAS_WIDTH}x${ATLAS_HEIGHT_V2}`,
      "INVALID_PET_PACKAGE",
      422,
    );
  }
  if (!Number.isSafeInteger(frameCount) || frameCount > MAX_PET_FRAMES) {
    throw new CompanionPetError(
      `frame count must not exceed ${MAX_PET_FRAMES}`,
      "INVALID_PET_PACKAGE",
      422,
    );
  }
  const spriteVersionNumber: 1 | 2 = atlasHeight === ATLAS_HEIGHT_V2 ? 2 : 1;
  if (requestedVersion !== undefined && requestedVersion !== spriteVersionNumber) {
    throw new CompanionPetError(
      "spriteVersionNumber does not match the frame grid",
      "INVALID_PET_PACKAGE",
      422,
    );
  }
  return { frame, spriteVersionNumber, frameCount };
}

function safeAnimationName(value: unknown, field: string): string {
  const name = safeManifestText(value, field, 80, true)!;
  if (name === "__proto__" || name === "prototype" || name === "constructor") {
    throw new CompanionPetError(`${field} is reserved`, "INVALID_PET_PACKAGE", 422);
  }
  return name;
}

function normalizeFrameIndices(value: unknown, frameCount: number, label: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ANIMATION_FRAMES) {
    throw new CompanionPetError(
      `${label} must contain 1-${MAX_ANIMATION_FRAMES} frames`,
      "INVALID_PET_PACKAGE",
      422,
    );
  }
  return value.map((frameIndex) => {
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= frameCount) {
      throw new CompanionPetError(
        `${label} references a frame outside the ${frameCount}-frame grid`,
        "INVALID_PET_PACKAGE",
        422,
      );
    }
    return frameIndex;
  });
}

function normalizeAnimation(
  value: unknown,
  frameCount: number,
  label: string,
): NormalizedPetAnimation {
  if (!isPlainRecord(value)) {
    throw new CompanionPetError(`${label} must be an object`, "INVALID_PET_PACKAGE", 422);
  }
  const isPioraNormalized = value.frameIndices !== undefined;
  const frameIndices = normalizeFrameIndices(
    isPioraNormalized ? value.frameIndices : value.frames,
    frameCount,
    `${label}.frames`,
  );
  const fallback = safeManifestText(value.fallback, `${label}.fallback`, 80) ?? "idle";
  safeAnimationName(fallback, `${label}.fallback`);

  if (isPioraNormalized) {
    if (!Array.isArray(value.durationsMs) || value.durationsMs.length !== frameIndices.length) {
      throw new CompanionPetError(
        `${label}.durationsMs must match its frame count`,
        "INVALID_PET_PACKAGE",
        422,
      );
    }
    const durationsMs = value.durationsMs.map((duration) => {
      if (!Number.isSafeInteger(duration) || duration <= 0 || duration > MAX_TIMER_DURATION_MS) {
        throw new CompanionPetError(
          `${label}.durationsMs contains an invalid duration`,
          "INVALID_PET_PACKAGE",
          422,
        );
      }
      return duration;
    });
    const loopStart = value.loopStart;
    if (loopStart !== null && typeof loopStart !== "number") {
      throw new CompanionPetError(`${label}.loopStart is invalid`, "INVALID_PET_PACKAGE", 422);
    }
    if (
      typeof loopStart === "number"
      && (!Number.isSafeInteger(loopStart) || loopStart < 0 || loopStart >= frameIndices.length)
    ) {
      throw new CompanionPetError(`${label}.loopStart is invalid`, "INVALID_PET_PACKAGE", 422);
    }
    return { frameIndices, durationsMs, loopStart, fallback };
  }

  const fps = value.fps === undefined || value.fps === null ? 8 : value.fps;
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0 || fps > MAX_ANIMATION_FPS) {
    throw new CompanionPetError(
      `${label}.fps must be finite and between 0 and ${MAX_ANIMATION_FPS}`,
      "INVALID_PET_PACKAGE",
      422,
    );
  }
  if (value.loop !== undefined && value.loop !== null && typeof value.loop !== "boolean") {
    throw new CompanionPetError(`${label}.loop must be a boolean`, "INVALID_PET_PACKAGE", 422);
  }
  const duration = Math.min(MAX_TIMER_DURATION_MS, Math.max(1, Math.round(1000 / fps)));
  return {
    frameIndices,
    durationsMs: frameIndices.map(() => duration),
    loopStart: value.loop === false ? null : 0,
    fallback,
  };
}

function cloneDefaultAnimations(
  spriteVersionNumber: 1 | 2,
): Record<string, NormalizedPetAnimation> {
  const clone = Object.create(null) as Record<string, NormalizedPetAnimation>;
  for (const [name, animation] of Object.entries(defaultPetAnimations(spriteVersionNumber))) {
    clone[name] = normalizedAnimation(
      [...animation.frameIndices],
      [...animation.durationsMs],
      animation.loopStart,
      animation.fallback,
    );
  }
  return clone;
}

function normalizeAnimations(
  value: unknown,
  frameCount: number,
  spriteVersionNumber: 1 | 2,
): Record<string, NormalizedPetAnimation> {
  const animations = cloneDefaultAnimations(spriteVersionNumber);
  if (value !== undefined) {
    if (!isPlainRecord(value)) {
      throw new CompanionPetError("animations must be an object", "INVALID_PET_PACKAGE", 422);
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_ANIMATIONS) {
      throw new CompanionPetError(
        `animations must not contain more than ${MAX_ANIMATIONS} states`,
        "INVALID_PET_PACKAGE",
        422,
      );
    }
    for (const [rawName, animation] of entries.sort(([left], [right]) => left.localeCompare(right))) {
      const name = safeAnimationName(rawName, "animation name");
      animations[name] = normalizeAnimation(animation, frameCount, `animation ${name}`);
    }
  }
  for (const [name, animation] of Object.entries(animations)) {
    normalizeFrameIndices(animation.frameIndices, frameCount, `animation ${name}.frames`);
    if (!Object.hasOwn(animations, animation.fallback)) {
      throw new CompanionPetError(
        `animation ${name} fallback ${animation.fallback} does not exist`,
        "INVALID_PET_PACKAGE",
        422,
      );
    }
  }
  if (!Object.hasOwn(animations, "idle")) {
    throw new CompanionPetError("animations must include idle", "INVALID_PET_PACKAGE", 422);
  }
  return animations;
}

export function normalizePetManifest(value: unknown, folderId: string): NormalizedPetManifest {
  requireValidPetId(folderId);
  if (!isPlainRecord(value)) {
    throw new CompanionPetError("pet.json must contain a JSON object", "INVALID_PET_PACKAGE", 422);
  }

  const manifestId = safeManifestText(value.id, "id", 80);
  const rawVersion = value.spriteVersionNumber === null ? undefined : value.spriteVersionNumber;
  if (rawVersion !== undefined && rawVersion !== 1 && rawVersion !== 2) {
    throw new CompanionPetError(
      "spriteVersionNumber must be 1, 2, or omitted for v1",
      "INVALID_PET_PACKAGE",
      422,
    );
  }
  const { frame, spriteVersionNumber, frameCount } = normalizeFrame(
    value.frame,
    rawVersion as 1 | 2 | undefined,
  );
  const spritesheet = normalizeSpritesheetSourcePath(value.spritesheetPath);
  const displayName = safeManifestText(value.displayName, "displayName", 80)
    ?? safeManifestText(value.name, "name", 80)
    ?? manifestId
    ?? folderId;
  let origin: CodexPetSourceKind | undefined;
  if (value.origin !== undefined) {
    if (typeof value.origin !== "string" || !CODEX_SOURCE_KINDS.has(value.origin as CodexPetSourceKind)) {
      throw new CompanionPetError("origin is invalid", "INVALID_PET_PACKAGE", 422);
    }
    origin = value.origin as CodexPetSourceKind;
  }

  return {
    schemaVersion: 1,
    id: folderId,
    displayName: displayName!,
    description: safeManifestText(value.description, "description", 280),
    author: safeManifestText(value.author, "author", 120),
    spriteVersionNumber,
    spritesheetPath: spritesheet.installedName,
    frame,
    animations: normalizeAnimations(value.animations, frameCount, spriteVersionNumber),
    ...(origin ? { origin } : {}),
  };
}

export function petFromManifest(
  manifest: NormalizedPetManifest,
  source: "codex" | "piora",
  sourceKind: CompanionPetSourceKind,
  installed: boolean,
): CompanionPet {
  const width = manifest.frame.width * manifest.frame.columns;
  const height = manifest.frame.height * manifest.frame.rows;
  const origin = sourceKind === "piora-installed" || sourceKind === "piora-bundled"
    ? manifest.origin
    : sourceKind;
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(manifest.author ? { author: manifest.author } : {}),
    spriteVersionNumber: manifest.spriteVersionNumber,
    spritesheetPath: manifest.spritesheetPath,
    atlasUrl: sourceKind === "piora-bundled"
      ? `${BUNDLED_COMPANION_PETS_PUBLIC_PATH}/${encodeURIComponent(manifest.id)}/${manifest.spritesheetPath}`
      : source === "piora"
        ? `/api/companion-pets/${encodeURIComponent(manifest.id)}/spritesheet`
        : `/api/companion-pets/${encodeURIComponent(manifest.id)}/spritesheet?sourceKind=${encodeURIComponent(sourceKind)}`,
    width,
    height,
    frame: { ...manifest.frame },
    columns: manifest.frame.columns,
    rows: manifest.frame.rows,
    frameWidth: manifest.frame.width,
    frameHeight: manifest.frame.height,
    frameCount: manifest.frame.columns * manifest.frame.rows,
    states: petAnimationStates(manifest.animations, manifest.frame.columns),
    source,
    sourceKind,
    sourceKey: `${sourceKind}:${manifest.id}`,
    ...(origin ? { origin } : {}),
    installed,
  };
}
