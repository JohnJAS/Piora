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

import {
  ALLOWED_SPRITESHEETS,
  CompanionPetError,
  MAX_IMAGE_CONTAINER_CHUNKS,
  type NormalizedPetManifest,
  type SpriteInspection,
} from "./pet-manifest";

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function inspectPng(bytes: Uint8Array): SpriteInspection | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || !signature.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let inspection: SpriteInspection | null = null;
  let sawImageData = false;
  let chunkCount = 0;
  while (offset + 12 <= bytes.length) {
    chunkCount += 1;
    if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) {
      throw new CompanionPetError("PNG spritesheet has too many chunks", "INVALID_PET_PACKAGE", 422);
    }
    const chunkSize = view.getUint32(offset, false);
    const type = ascii(bytes, offset + 4, 4);
    const payload = offset + 8;
    const chunkEnd = payload + chunkSize + 4;
    if (chunkEnd > bytes.length) {
      throw new CompanionPetError("PNG spritesheet has a truncated chunk", "INVALID_PET_PACKAGE", 422);
    }
    if (!inspection) {
      if (offset !== 8 || type !== "IHDR" || chunkSize !== 13) {
        throw new CompanionPetError("PNG spritesheet has an invalid IHDR", "INVALID_PET_PACKAGE", 422);
      }
      inspection = {
        mimeType: "image/png",
        width: view.getUint32(payload, false),
        height: view.getUint32(payload + 4, false),
      };
    } else if (type === "IHDR") {
      throw new CompanionPetError("PNG spritesheet has multiple IHDR chunks", "INVALID_PET_PACKAGE", 422);
    }
    if (type === "IDAT" && chunkSize > 0) sawImageData = true;
    if (type === "IEND") {
      if (chunkSize !== 0 || !sawImageData || chunkEnd !== bytes.length) {
        throw new CompanionPetError("PNG spritesheet has an invalid ending", "INVALID_PET_PACKAGE", 422);
      }
      return inspection;
    }
    offset = chunkEnd;
  }
  throw new CompanionPetError("PNG spritesheet is missing image data or IEND", "INVALID_PET_PACKAGE", 422);
}

function inspectWebpImageChunk(
  bytes: Uint8Array,
  view: DataView,
  type: string,
  payload: number,
  chunkSize: number,
): SpriteInspection | null {
  if (type === "VP8L" && chunkSize >= 5 && bytes[payload] === 0x2f) {
    const b1 = bytes[payload + 1];
    const b2 = bytes[payload + 2];
    const b3 = bytes[payload + 3];
    const b4 = bytes[payload + 4];
    return {
      mimeType: "image/webp",
      width: 1 + b1 + ((b2 & 0x3f) << 8),
      height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
    };
  }
  if (
    type === "VP8 "
    && chunkSize >= 10
    && bytes[payload + 3] === 0x9d
    && bytes[payload + 4] === 0x01
    && bytes[payload + 5] === 0x2a
  ) {
    return {
      mimeType: "image/webp",
      width: view.getUint16(payload + 6, true) & 0x3fff,
      height: view.getUint16(payload + 8, true) & 0x3fff,
    };
  }
  return null;
}

function inspectWebp(bytes: Uint8Array): SpriteInspection | null {
  if (
    bytes.length < 20
    || ascii(bytes, 0, 4) !== "RIFF"
    || ascii(bytes, 8, 4) !== "WEBP"
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredSize = view.getUint32(4, true) + 8;
  if (declaredSize > bytes.length) {
    throw new CompanionPetError("WebP spritesheet is truncated", "INVALID_PET_PACKAGE", 422);
  }
  if (declaredSize !== bytes.length) {
    throw new CompanionPetError("WebP spritesheet has trailing data", "INVALID_PET_PACKAGE", 422);
  }

  let offset = 12;
  let inspection: SpriteInspection | null = null;
  let sawImageData = false;
  let sawExtendedHeader = false;
  let chunkCount = 0;
  while (offset + 8 <= declaredSize) {
    chunkCount += 1;
    if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) {
      throw new CompanionPetError("WebP spritesheet has too many chunks", "INVALID_PET_PACKAGE", 422);
    }
    const type = ascii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + chunkSize > declaredSize) {
      throw new CompanionPetError("WebP spritesheet has an invalid chunk", "INVALID_PET_PACKAGE", 422);
    }
    if (type === "VP8X") {
      if (chunkSize !== 10 || inspection) {
        throw new CompanionPetError("WebP spritesheet has an invalid VP8X chunk", "INVALID_PET_PACKAGE", 422);
      }
      inspection = {
        mimeType: "image/webp",
        width: readUint24LE(bytes, payload + 4) + 1,
        height: readUint24LE(bytes, payload + 7) + 1,
      };
      sawExtendedHeader = true;
    }
    const frameInspection = inspectWebpImageChunk(bytes, view, type, payload, chunkSize);
    if (frameInspection) {
      if (
        inspection
        && (inspection.width !== frameInspection.width || inspection.height !== frameInspection.height)
      ) {
        throw new CompanionPetError("WebP canvas and frame dimensions do not match", "INVALID_PET_PACKAGE", 422);
      }
      inspection ??= frameInspection;
      sawImageData = true;
    }
    if (type === "ANMF") {
      if (!inspection || !sawExtendedHeader || chunkSize < 24) {
        throw new CompanionPetError("WebP spritesheet has an invalid animation frame", "INVALID_PET_PACKAGE", 422);
      }
      const frameX = readUint24LE(bytes, payload) * 2;
      const frameY = readUint24LE(bytes, payload + 3) * 2;
      const frameWidth = readUint24LE(bytes, payload + 6) + 1;
      const frameHeight = readUint24LE(bytes, payload + 9) + 1;
      if (frameX + frameWidth > inspection.width || frameY + frameHeight > inspection.height) {
        throw new CompanionPetError("WebP animation frame exceeds its canvas", "INVALID_PET_PACKAGE", 422);
      }
      const frameEnd = payload + chunkSize;
      let nestedOffset = payload + 16;
      let nestedImage: SpriteInspection | null = null;
      while (nestedOffset + 8 <= frameEnd) {
        chunkCount += 1;
        if (chunkCount > MAX_IMAGE_CONTAINER_CHUNKS) {
          throw new CompanionPetError("WebP spritesheet has too many chunks", "INVALID_PET_PACKAGE", 422);
        }
        const nestedType = ascii(bytes, nestedOffset, 4);
        const nestedSize = view.getUint32(nestedOffset + 4, true);
        const nestedPayload = nestedOffset + 8;
        if (nestedPayload + nestedSize > frameEnd) {
          throw new CompanionPetError("WebP animation frame is truncated", "INVALID_PET_PACKAGE", 422);
        }
        const candidateImage = inspectWebpImageChunk(
          bytes,
          view,
          nestedType,
          nestedPayload,
          nestedSize,
        );
        if (candidateImage) {
          if (nestedImage) {
            throw new CompanionPetError("WebP animation frame has multiple images", "INVALID_PET_PACKAGE", 422);
          }
          nestedImage = candidateImage;
        }
        nestedOffset = nestedPayload + nestedSize + (nestedSize % 2);
      }
      if (
        nestedOffset !== frameEnd
        || !nestedImage
        || nestedImage.width !== frameWidth
        || nestedImage.height !== frameHeight
      ) {
        throw new CompanionPetError("WebP animation frame is invalid", "INVALID_PET_PACKAGE", 422);
      }
      sawImageData = true;
    }
    offset = payload + chunkSize + (chunkSize % 2);
  }
  if (offset !== declaredSize) {
    throw new CompanionPetError("WebP spritesheet has invalid chunk padding", "INVALID_PET_PACKAGE", 422);
  }
  if (!inspection || !sawImageData) {
    throw new CompanionPetError("WebP spritesheet dimensions or image data were not found", "INVALID_PET_PACKAGE", 422);
  }
  return inspection;
}

export function inspectPetSpritesheetBytes(
  bytes: Uint8Array,
  fileName: string,
): SpriteInspection {
  const inspection = inspectPng(bytes) ?? inspectWebp(bytes);
  if (!inspection) {
    throw new CompanionPetError(
      "Spritesheet must contain PNG or WebP bytes",
      "INVALID_PET_PACKAGE",
      422,
    );
  }
  const expectedMime = fileName === "spritesheet.png" ? "image/png" : "image/webp";
  if (!ALLOWED_SPRITESHEETS.has(fileName) || inspection.mimeType !== expectedMime) {
    throw new CompanionPetError(
      "Spritesheet extension does not match its image bytes",
      "INVALID_PET_PACKAGE",
      422,
    );
  }
  return inspection;
}

export function assertAtlasGeometry(
  inspection: SpriteInspection,
  manifest: Pick<NormalizedPetManifest, "frame" | "spriteVersionNumber">,
): void {
  const expectedWidth = manifest.frame.width * manifest.frame.columns;
  const expectedHeight = manifest.frame.height * manifest.frame.rows;
  if (inspection.width !== expectedWidth || inspection.height !== expectedHeight) {
    throw new CompanionPetError(
      `Pet v${manifest.spriteVersionNumber} spritesheet must be ${expectedWidth}x${expectedHeight}`,
      "INVALID_PET_PACKAGE",
      422,
    );
  }
}
