import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import JSZip from "jszip";

const jiti = createJiti(import.meta.url);
const {
  CompanionPetError,
  PET_MANIFEST_MAX_BYTES,
  PET_SPRITESHEET_MAX_BYTES,
  getCodexPetAnimationStates,
  getCodexBuiltinPetsAssetsDirectory,
  getCodexLegacyAvatarsDirectory,
  getCodexPetsDirectory,
  getPioraPetsDirectory,
  importCodexPet,
  importCodexPetArchive,
  inspectPetSpritesheetBytes,
  isValidPetId,
  listCompanionPets,
  normalizePetManifest,
  readInstalledPetSpritesheet,
} = await jiti.import("./companion-pets.ts");

function pngHeader(width, height) {
  const bytes = Buffer.alloc(58);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  bytes.writeUInt32BE(1, 33);
  bytes.write("IDAT", 37, "ascii");
  bytes[41] = 0;
  bytes.writeUInt32BE(0, 46);
  bytes.write("IEND", 50, "ascii");
  return bytes;
}

function webpVpxHeader(width, height) {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(40, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  bytes.write("VP8 ", 30, "ascii");
  bytes.writeUInt32LE(10, 34);
  bytes[41] = 0x9d;
  bytes[42] = 0x01;
  bytes[43] = 0x2a;
  bytes.writeUInt16LE(width, 44);
  bytes.writeUInt16LE(height, 46);
  return bytes;
}

function webpEmptyAnimationHeader(width, height) {
  const bytes = Buffer.alloc(54);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  bytes.write("ANMF", 30, "ascii");
  bytes.writeUInt32LE(16, 34);
  bytes.writeUIntLE(width - 1, 44, 3);
  bytes.writeUIntLE(height - 1, 47, 3);
  return bytes;
}

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "piora-pets-"));
  const runtimeHome = path.join(base, "home");
  const codexHome = path.join(base, "codex-home");
  fs.mkdirSync(path.join(codexHome, "pets"), { recursive: true });
  fs.mkdirSync(runtimeHome, { recursive: true });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return {
    base,
    runtimeHome,
    codexHome,
    environment: { PIORA_HOME: runtimeHome, CODEX_HOME: codexHome },
  };
}

function writeSourcePet(codexHome, options = {}) {
  const id = options.id ?? "focus-fox";
  const version = options.version ?? 2;
  const extension = options.extension ?? "webp";
  const folder = path.join(codexHome, "pets", id);
  fs.mkdirSync(folder, { recursive: true });
  const manifest = {
    id,
    displayName: options.displayName ?? "Focus Fox",
    description: "A quiet coding companion.",
    author: "Local Artist",
    spriteVersionNumber: version,
    spritesheetPath: `spritesheet.${extension}`,
    // Unknown fields are intentionally not copied into Pi GUI's normalized manifest.
    script: "do-not-copy.js",
    remoteAsset: "https://example.invalid/pet.webp",
    ...options.manifest,
  };
  fs.writeFileSync(path.join(folder, "pet.json"), JSON.stringify(manifest));
  const height = options.height ?? (version === 2 ? 2288 : 1872);
  const bytes = extension === "png"
    ? pngHeader(options.width ?? 1536, height)
    : webpVpxHeader(options.width ?? 1536, height);
  fs.writeFileSync(path.join(folder, `spritesheet.${extension}`), bytes);
  return folder;
}

test("validates sanitized ids and normalizes only declarative manifest fields", () => {
  assert.equal(isValidPetId("focus-fox.v2"), true);
  assert.equal(isValidPetId("COM10"), true);
  assert.equal(isValidPetId("../escape"), false);
  assert.equal(isValidPetId("pet/child"), false);
  assert.equal(isValidPetId(".hidden"), false);
  for (const invalid of ["pet.", "CON", "con.txt", "NUL", "LPT9.log", null, 42]) {
    assert.equal(isValidPetId(invalid), false, `${String(invalid)} must be rejected`);
  }

  const manifest = normalizePetManifest({
    id: "focus-fox",
    displayName: "Focus Fox",
    description: "Quiet helper",
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp",
    scripts: ["evil.js"],
    url: "https://example.invalid",
  }, "focus-fox");
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, "focus-fox");
  assert.equal(manifest.displayName, "Focus Fox");
  assert.equal(manifest.description, "Quiet helper");
  assert.equal(manifest.spriteVersionNumber, 2);
  assert.equal(manifest.spritesheetPath, "spritesheet.webp");
  assert.deepEqual(manifest.frame, { width: 192, height: 208, columns: 8, rows: 11 });
  assert.deepEqual(manifest.animations.idle.frameIndices, [0, 1, 2, 3, 4, 5]);
  assert.equal("scripts" in manifest, false);
  assert.equal("url" in manifest, false);
});

test("supports current Codex optional metadata and canonicalizes the folder id", () => {
  const minimal = normalizePetManifest({}, "folder-pet");
  assert.equal(minimal.id, "folder-pet");
  assert.equal(minimal.displayName, "folder-pet");
  assert.equal(minimal.spritesheetPath, "spritesheet.webp");

  const mismatched = normalizePetManifest({ id: "manifest display fallback" }, "folder-pet");
  assert.equal(mismatched.id, "folder-pet");
  assert.equal(mismatched.displayName, "manifest display fallback");

  const emptyMetadata = normalizePetManifest({ id: "  ", displayName: "  " }, "folder-pet");
  assert.equal(emptyMetadata.displayName, "folder-pet");
});

test("normalizes custom frame grids and absolute-index Codex animations", () => {
  const manifest = normalizePetManifest({
    displayName: "Tall Pet",
    spritesheetPath: "art/atlas.PNG",
    frame: { width: 384, height: 104, columns: 4, rows: 18 },
    animations: {
      idle: { frames: [0, 5, 7], fps: 2 },
      inspect: { frames: [70, 1], fps: 4, loop: false, fallback: "idle" },
    },
  }, "tall-pet");
  assert.deepEqual(manifest.frame, { width: 384, height: 104, columns: 4, rows: 18 });
  assert.equal(manifest.spritesheetPath, "spritesheet.png");
  assert.deepEqual(manifest.animations.idle, {
    frameIndices: [0, 5, 7],
    durationsMs: [500, 500, 500],
    loopStart: 0,
    fallback: "idle",
  });
  assert.deepEqual(manifest.animations.inspect, {
    frameIndices: [70, 1],
    durationsMs: [250, 250],
    loopStart: null,
    fallback: "idle",
  });
});

test("rejects path escapes, unsafe text, invalid frame grids, and invalid animations", () => {
  assert.throws(
    () => normalizePetManifest({
      id: "pet",
      displayName: "Pet",
      spritesheetPath: "https://example.invalid/pet.webp",
    }, "pet"),
    /stay inside|unsafe path/,
  );
  assert.throws(
    () => normalizePetManifest({
      id: "pet",
      displayName: "<img src=x>",
      spritesheetPath: "spritesheet.webp",
    }, "pet"),
    /unsafe text/,
  );
  assert.throws(
    () => normalizePetManifest({
      id: "pet",
      displayName: "Safe-looking\u202Ecod.exe",
      spritesheetPath: "spritesheet.webp",
    }, "pet"),
    /unsafe text/,
  );
  assert.throws(
    () => normalizePetManifest({
      id: "pet",
      displayName: "Pet",
      spriteVersionNumber: 3,
      spritesheetPath: "spritesheet.webp",
    }, "pet"),
    /must be 1, 2/,
  );
  assert.throws(
    () => normalizePetManifest({
      displayName: "Bad grid",
      frame: { width: 192, height: 208, columns: 7, rows: 9 },
    }, "pet"),
    /frame grid must cover exactly/,
  );
  assert.throws(
    () => normalizePetManifest({
      displayName: "Bad animation",
      animations: { inspect: { frames: [72], fallback: "missing" } },
    }, "pet"),
    /outside the 72-frame grid/,
  );
  assert.throws(
    () => normalizePetManifest({
      displayName: "Bad fallback",
      animations: { inspect: { frames: [1], fallback: "missing" } },
    }, "pet"),
    /fallback missing does not exist/,
  );
  assert.throws(
    () => normalizePetManifest({
      displayName: "Prototype",
      animations: JSON.parse('{"__proto__":{"frames":[1]}}'),
    }, "pet"),
    /reserved/,
  );
});

test("parses PNG and WebP atlas headers and rejects extension spoofing", () => {
  assert.deepEqual(inspectPetSpritesheetBytes(pngHeader(1536, 1872), "spritesheet.png"), {
    mimeType: "image/png",
    width: 1536,
    height: 1872,
  });
  assert.deepEqual(inspectPetSpritesheetBytes(webpVpxHeader(1536, 2288), "spritesheet.webp"), {
    mimeType: "image/webp",
    width: 1536,
    height: 2288,
  });
  assert.throws(
    () => inspectPetSpritesheetBytes(Buffer.from("<html>not an image</html>"), "spritesheet.webp"),
    /PNG or WebP/,
  );
  assert.throws(
    () => inspectPetSpritesheetBytes(pngHeader(1536, 1872), "spritesheet.webp"),
    /extension does not match/,
  );
});

test("rejects truncated image containers and malformed headers without leaking native errors", () => {
  const png = pngHeader(1536, 1872);
  const webp = webpVpxHeader(1536, 2288);
  for (const bytes of [
    png.subarray(0, 24),
    png.subarray(0, png.length - 1),
    webp.subarray(0, 30),
    Buffer.concat([webp, Buffer.from("trailing")]),
    webpEmptyAnimationHeader(1536, 2288),
  ]) {
    assert.throws(
      () => inspectPetSpritesheetBytes(bytes, bytes[0] === 0x89 ? "spritesheet.png" : "spritesheet.webp"),
      (error) => error instanceof CompanionPetError && error.code === "INVALID_PET_PACKAGE",
    );
  }

  const chunkFlood = Buffer.alloc(12 + (8_193 * 8));
  chunkFlood.write("RIFF", 0, "ascii");
  chunkFlood.writeUInt32LE(chunkFlood.length - 8, 4);
  chunkFlood.write("WEBP", 8, "ascii");
  for (let offset = 12; offset < chunkFlood.length; offset += 8) {
    chunkFlood.write("JUNK", offset, "ascii");
  }
  assert.throws(
    () => inspectPetSpritesheetBytes(chunkFlood, "spritesheet.webp"),
    /too many chunks/,
  );

  let seed = 0x6d2b79f5;
  for (let sample = 0; sample < 512; sample += 1) {
    const length = sample % 97;
    const bytes = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      bytes[index] = seed & 0xff;
    }
    assert.throws(
      () => inspectPetSpritesheetBytes(bytes, "spritesheet.webp"),
      (error) => error instanceof CompanionPetError,
    );
  }
});

test("exposes normalized Codex animation timelines and legacy v2 direction rows", () => {
  const v1 = getCodexPetAnimationStates(1);
  const v2 = getCodexPetAnimationStates(2);
  assert.equal(v1.length, 14);
  const idle = v1.find((state) => state.id === "idle");
  assert.deepEqual(idle.frameIndices, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(idle.durationsMs, [1680, 660, 660, 840, 840, 1920]);
  assert.equal(idle.row, 0);
  const running = v1.find((state) => state.id === "running");
  assert.equal(running.loopStart, 18);
  assert.equal(running.row, null);
  assert.deepEqual(running.frameIndices.slice(0, 6), [56, 57, 58, 59, 60, 61]);
  assert.equal(v2.length, 16);
  assert.deepEqual(v2.find((state) => state.id === "look-directions-a").directionsDegrees, [0, 22.5, 45, 67.5, 90, 112.5, 135, 157.5]);
  assert.deepEqual(v2.find((state) => state.id === "look-directions-b").directionsDegrees, [180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5]);
});

test("discovers valid Codex pets and reports invalid packages without exposing them", (t) => {
  const { codexHome, environment } = fixture(t);
  writeSourcePet(codexHome);
  writeSourcePet(codexHome, { id: "legacy-cat", version: 1, extension: "png" });
  writeSourcePet(codexHome, { id: "bad-size", version: 2, height: 1872 });

  const result = listCompanionPets(environment);
  assert.equal(result.codexSourceAvailable, true);
  assert.deepEqual(result.sources.map((pet) => pet.id), ["focus-fox", "legacy-cat"]);
  assert.equal(
    result.sources[0].atlasUrl,
    "/api/companion-pets/focus-fox/spritesheet?sourceKind=codex-custom",
  );
  assert.equal(result.sources[0].installed, false);
  assert.equal(result.sources[0].rows, 11);
  assert.equal(result.sources[1].rows, 9);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].id, "bad-size");
  assert.match(result.diagnostics[0].message, /1536x2288/);
});

test("imports a current Codex manifest with a nested asset, custom frame grid, and animations", (t) => {
  const { environment } = fixture(t);
  const folder = path.join(getCodexPetsDirectory(environment), "current-pet");
  const assetFolder = path.join(folder, "art");
  fs.mkdirSync(assetFolder, { recursive: true });
  fs.writeFileSync(path.join(folder, "pet.json"), JSON.stringify({
    displayName: "Current Pet",
    description: "Current Codex manifest contract",
    spritesheetPath: "art/custom-atlas.PNG",
    frame: { width: 384, height: 104, columns: 4, rows: 18 },
    animations: {
      idle: { frames: [0, 5, 7], fps: 2 },
      inspect: { frames: [70, 1], fps: 4, loop: false, fallback: "idle" },
    },
    script: "must-not-survive.js",
    remoteAsset: "https://example.invalid/pet.png",
  }));
  fs.writeFileSync(path.join(assetFolder, "custom-atlas.PNG"), pngHeader(1536, 1872));

  const listing = listCompanionPets(environment);
  const source = listing.sources.find((pet) => pet.id === "current-pet");
  assert.equal(source.sourceKind, "codex-custom");
  assert.equal(source.sourceKey, "codex-custom:current-pet");
  assert.deepEqual(source.frame, { width: 384, height: 104, columns: 4, rows: 18 });
  const inspect = source.states.find((state) => state.id === "inspect");
  assert.deepEqual(inspect.frameIndices, [70, 1]);
  assert.deepEqual(inspect.durationsMs, [250, 250]);
  assert.equal(inspect.loopStart, null);
  assert.equal(inspect.row, null);

  const imported = importCodexPet("current-pet", environment, "codex-custom");
  assert.equal(imported.pet.origin, "codex-custom");
  assert.equal(imported.pet.spritesheetPath, "spritesheet.png");
  const installedFolder = path.join(getPioraPetsDirectory(environment), "current-pet");
  const installedManifest = JSON.parse(fs.readFileSync(path.join(installedFolder, "pet.json"), "utf8"));
  assert.equal(installedManifest.origin, "codex-custom");
  assert.equal(installedManifest.spritesheetPath, "spritesheet.png");
  assert.equal("script" in installedManifest, false);
  assert.equal("remoteAsset" in installedManifest, false);
  assert.deepEqual(installedManifest.animations.inspect.frameIndices, [70, 1]);
  assert.deepEqual(
    fs.readFileSync(path.join(installedFolder, "spritesheet.png")),
    pngHeader(1536, 1872),
  );
});

test("imports a Codex pet ZIP from a wrapper folder and validates its contents", async (t) => {
  const { environment } = fixture(t);
  const archive = new JSZip();
  archive.file("zip-fox/pet.json", JSON.stringify({
    id: "zip-fox",
    displayName: "ZIP Fox",
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp",
  }));
  archive.file("zip-fox/spritesheet.webp", webpVpxHeader(1536, 2288));
  const bytes = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  const result = await importCodexPetArchive(bytes, "zip-fox.zip", environment);
  assert.equal(result.replaced, false);
  assert.equal(result.pet.id, "zip-fox");
  assert.equal(result.pet.displayName, "ZIP Fox");
  assert.equal(result.pet.installed, true);
  assert.ok(fs.existsSync(path.join(getPioraPetsDirectory(environment), "zip-fox", "pet.json")));
  assert.ok(fs.existsSync(path.join(getPioraPetsDirectory(environment), "zip-fox", "spritesheet.webp")));
});

test("rejects Codex pet ZIPs without a manifest or spritesheet", async (t) => {
  const { environment } = fixture(t);
  const missingManifest = new JSZip();
  missingManifest.file("spritesheet.webp", webpVpxHeader(1536, 2288));
  await assert.rejects(
    importCodexPetArchive(
      await missingManifest.generateAsync({ type: "nodebuffer" }),
      "missing-manifest.zip",
      environment,
    ),
    /pet\.json/,
  );

  const missingSprite = new JSZip();
  missingSprite.file("pet.json", JSON.stringify({ id: "missing-sprite", displayName: "Missing" }));
  await assert.rejects(
    importCodexPetArchive(
      await missingSprite.generateAsync({ type: "nodebuffer" }),
      "missing-sprite.zip",
      environment,
    ),
    /spritesheet/,
  );
});

test("discovers and imports local Codex built-in cache pets and legacy avatars", (t) => {
  const { environment } = fixture(t);
  writeSourcePet(environment.CODEX_HOME, {
    id: "dewey",
    displayName: "Custom Dewey",
    version: 1,
  });
  const builtinRoot = getCodexBuiltinPetsAssetsDirectory(environment);
  fs.mkdirSync(builtinRoot, { recursive: true });
  const builtinBytes = webpVpxHeader(1536, 1872);
  fs.writeFileSync(path.join(builtinRoot, "dewey-spritesheet-v4.webp"), builtinBytes);

  const legacyFolder = path.join(getCodexLegacyAvatarsDirectory(environment), "legacy-owl");
  fs.mkdirSync(legacyFolder, { recursive: true });
  fs.writeFileSync(path.join(legacyFolder, "avatar.json"), JSON.stringify({
    displayName: "Legacy Owl",
    spritesheetPath: "owl.webp",
  }));
  fs.writeFileSync(path.join(legacyFolder, "owl.webp"), webpVpxHeader(1536, 1872));

  const listing = listCompanionPets(environment);
  const builtin = listing.sources.find((pet) => pet.sourceKind === "codex-builtin-cache" && pet.id === "dewey");
  const custom = listing.sources.find((pet) => pet.sourceKind === "codex-custom" && pet.id === "dewey");
  const legacy = listing.sources.find((pet) => pet.id === "legacy-owl");
  assert.equal(builtin.sourceKind, "codex-builtin-cache");
  assert.equal(builtin.displayName, "Dewey");
  assert.equal(custom.displayName, "Custom Dewey");
  assert.notEqual(builtin.sourceKey, custom.sourceKey);
  assert.equal(legacy.sourceKind, "codex-legacy-avatar");
  assert.equal(legacy.displayName, "Legacy Owl");

  const importedBuiltin = importCodexPet("dewey", environment, "codex-builtin-cache");
  const importedLegacy = importCodexPet("legacy-owl", environment, "codex-legacy-avatar");
  assert.equal(importedBuiltin.pet.origin, "codex-builtin-cache");
  assert.equal(importedLegacy.pet.origin, "codex-legacy-avatar");
  const listingAfterImport = listCompanionPets(environment);
  assert.equal(
    listingAfterImport.sources.find((pet) => pet.sourceKey === "codex-builtin-cache:dewey").installed,
    true,
  );
  assert.equal(
    listingAfterImport.sources.find((pet) => pet.sourceKey === "codex-custom:dewey").installed,
    false,
  );
  assert.deepEqual(
    fs.readFileSync(path.join(getPioraPetsDirectory(environment), "dewey", "spritesheet.webp")),
    builtinBytes,
  );
});

test("atomically imports and replaces a Codex pet using Pi GUI-owned storage", (t) => {
  const { codexHome, environment } = fixture(t);
  const sourceFolder = writeSourcePet(codexHome);

  const first = importCodexPet("focus-fox", environment);
  assert.equal(first.replaced, false);
  assert.equal(first.pet.source, "piora");
  assert.equal(first.pet.installed, true);
  assert.equal(first.pet.atlasUrl, "/api/companion-pets/focus-fox/spritesheet");

  const installFolder = path.join(getPioraPetsDirectory(environment), "focus-fox");
  const installedManifest = JSON.parse(fs.readFileSync(path.join(installFolder, "pet.json"), "utf8"));
  assert.equal(installedManifest.schemaVersion, 1);
  assert.equal("script" in installedManifest, false);
  assert.equal("remoteAsset" in installedManifest, false);
  assert.deepEqual(
    fs.readFileSync(path.join(installFolder, "spritesheet.webp")),
    fs.readFileSync(path.join(sourceFolder, "spritesheet.webp")),
  );

  const changedManifest = JSON.parse(fs.readFileSync(path.join(sourceFolder, "pet.json"), "utf8"));
  changedManifest.displayName = "Focus Fox Updated";
  fs.writeFileSync(path.join(sourceFolder, "pet.json"), JSON.stringify(changedManifest));
  const second = importCodexPet("focus-fox", environment);
  assert.equal(second.replaced, true);
  assert.equal(second.pet.displayName, "Focus Fox Updated");

  const listing = listCompanionPets(environment);
  assert.equal(listing.installed.length, 2);
  assert.ok(listing.installed.some((pet) => (
    pet.id === "pekka-pal.codex-pet"
    && pet.sourceKind === "piora-bundled"
    && pet.atlasUrl === "/companion-pets/bundled/pekka-pal.codex-pet/spritesheet.webp"
  )));
  assert.equal(listing.sources[0].installed, true);
  assert.equal(
    fs.readdirSync(getPioraPetsDirectory(environment)).some((name) => name.startsWith(".import-") || name.startsWith(".backup-")),
    false,
  );
});

test("rolls an existing install back when the atomic staging rename fails", (t) => {
  const { codexHome, environment } = fixture(t);
  const sourceFolder = writeSourcePet(codexHome, { id: "rollback-fox" });
  importCodexPet("rollback-fox", environment);
  const installRoot = getPioraPetsDirectory(environment);
  const destination = path.join(installRoot, "rollback-fox");
  const originalInstalledManifest = fs.readFileSync(path.join(destination, "pet.json"), "utf8");

  const sourceManifestPath = path.join(sourceFolder, "pet.json");
  const changedManifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
  changedManifest.displayName = "Replacement That Must Roll Back";
  fs.writeFileSync(sourceManifestPath, JSON.stringify(changedManifest));

  const originalRenameSync = fs.renameSync;
  fs.renameSync = function injectedRenameFailure(source, target) {
    if (path.basename(String(source)).startsWith(".import-") && path.resolve(String(target)) === path.resolve(destination)) {
      throw new Error("injected staging rename failure");
    }
    return originalRenameSync.call(fs, source, target);
  };
  try {
    assert.throws(
      () => importCodexPet("rollback-fox", environment),
      (error) => error instanceof CompanionPetError && error.code === "PET_IMPORT_FAILED",
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(fs.readFileSync(path.join(destination, "pet.json"), "utf8"), originalInstalledManifest);
  assert.equal(
    fs.readdirSync(installRoot).some((name) => name.startsWith(".import-") || name.startsWith(".backup-")),
    false,
  );
});

test("does not replace a destination that changes after the initial safety check", (t) => {
  const { base, codexHome, environment } = fixture(t);
  writeSourcePet(codexHome, { id: "swap-fox" });
  importCodexPet("swap-fox", environment);
  const destination = path.join(getPioraPetsDirectory(environment), "swap-fox");
  const displaced = path.join(base, "displaced-original");
  const originalLstatSync = fs.lstatSync;
  let destinationChecks = 0;
  fs.lstatSync = function swapBeforeSecondCheck(file, ...args) {
    if (path.resolve(String(file)) === path.resolve(destination)) {
      destinationChecks += 1;
      if (destinationChecks === 2) {
        fs.renameSync(destination, displaced);
        fs.mkdirSync(destination);
        fs.writeFileSync(path.join(destination, "attacker-marker.txt"), "must survive");
      }
    }
    return originalLstatSync.call(fs, file, ...args);
  };
  try {
    assert.throws(
      () => importCodexPet("swap-fox", environment),
      (error) => error instanceof CompanionPetError && error.code === "PET_ACCESS_DENIED",
    );
  } finally {
    fs.lstatSync = originalLstatSync;
  }

  assert.equal(fs.readFileSync(path.join(destination, "attacker-marker.txt"), "utf8"), "must survive");
  assert.equal(fs.existsSync(path.join(displaced, "pet.json")), true);
});

test("bounds reads even when a package file grows between stat and read", (t) => {
  const { codexHome, environment } = fixture(t);
  const sourceFolder = writeSourcePet(codexHome, { id: "racing-fox" });
  const manifestPath = path.join(sourceFolder, "pet.json");
  const originalReadSync = fs.readSync;
  let mutated = false;
  fs.readSync = function mutateAfterStat(...args) {
    if (!mutated) {
      mutated = true;
      fs.appendFileSync(manifestPath, " ");
    }
    return originalReadSync.apply(fs, args);
  };
  try {
    assert.throws(
      () => importCodexPet("racing-fox", environment),
      (error) => error instanceof CompanionPetError && error.code === "INVALID_PET_PACKAGE",
    );
  } finally {
    fs.readSync = originalReadSync;
  }
});

test("rechecks the descriptor size before allocating the read buffer", (t) => {
  const { codexHome, environment } = fixture(t);
  const sourceFolder = writeSourcePet(codexHome, { id: "open-race-fox" });
  const manifestPath = path.join(sourceFolder, "pet.json");
  const originalOpenSync = fs.openSync;
  let mutated = false;
  fs.openSync = function mutateBeforeOpen(file, ...args) {
    if (!mutated && path.resolve(String(file)) === path.resolve(manifestPath)) {
      mutated = true;
      fs.truncateSync(manifestPath, PET_MANIFEST_MAX_BYTES + 1);
    }
    return originalOpenSync.call(fs, file, ...args);
  };
  try {
    assert.throws(
      () => importCodexPet("open-race-fox", environment),
      (error) => error instanceof CompanionPetError && error.code === "PET_TOO_LARGE",
    );
  } finally {
    fs.openSync = originalOpenSync;
  }
});

test("rejects oversized spritesheets before reading them into memory", (t) => {
  const { codexHome, environment } = fixture(t);
  const sourceFolder = writeSourcePet(codexHome, { id: "oversized-fox" });
  fs.truncateSync(
    path.join(sourceFolder, "spritesheet.webp"),
    PET_SPRITESHEET_MAX_BYTES + 1,
  );
  assert.throws(
    () => importCodexPet("oversized-fox", environment),
    (error) => error instanceof CompanionPetError && error.code === "PET_TOO_LARGE",
  );
});

test("serves only installed pets and revalidates bytes before returning", (t) => {
  const { codexHome, environment } = fixture(t);
  writeSourcePet(codexHome, { id: "safe-pet", version: 1, extension: "png" });
  assert.throws(
    () => readInstalledPetSpritesheet("safe-pet", environment),
    (error) => error instanceof CompanionPetError && error.code === "PET_NOT_FOUND",
  );
  importCodexPet("safe-pet", environment);
  const result = readInstalledPetSpritesheet("safe-pet", environment);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.pet.spriteVersionNumber, 1);

  fs.writeFileSync(
    path.join(getPioraPetsDirectory(environment), "safe-pet", "spritesheet.png"),
    Buffer.from("not an image"),
  );
  assert.throws(
    () => readInstalledPetSpritesheet("safe-pet", environment),
    /PNG or WebP/,
  );
});

test("uses CODEX_HOME and runtime-home conventions", (t) => {
  const { codexHome, runtimeHome, environment } = fixture(t);
  assert.equal(getCodexPetsDirectory(environment), path.join(codexHome, "pets"));
  assert.equal(
    getPioraPetsDirectory(environment),
    path.join(runtimeHome, ".pi", "agent", "piora", "pets"),
  );
  const relocatedAgentDirectory = path.join(runtimeHome, "relocated-agent-data");
  assert.equal(
    getPioraPetsDirectory({ ...environment, PI_CODING_AGENT_DIR: relocatedAgentDirectory }),
    path.join(relocatedAgentDirectory, "piora", "pets"),
  );
});

test("rejects source spritesheet symlinks when the platform permits creating one", (t) => {
  const { base, codexHome, environment } = fixture(t);
  const folder = writeSourcePet(codexHome, { id: "linked-pet" });
  const target = path.join(base, "outside.webp");
  fs.writeFileSync(target, webpVpxHeader(1536, 2288));
  fs.rmSync(path.join(folder, "spritesheet.webp"));
  try {
    fs.symlinkSync(target, path.join(folder, "spritesheet.webp"), "file");
  } catch (error) {
    t.skip(`symlink unavailable: ${error.code ?? error.message}`);
    return;
  }
  const result = listCompanionPets(environment);
  assert.equal(result.sources.length, 0);
  assert.equal(result.diagnostics[0].id, "linked-pet");
  assert.match(result.diagnostics[0].message, /symbolic links|regular file/);
});

test("rejects symlinked directories inside an arbitrary spritesheet path", (t) => {
  const { base, codexHome, environment } = fixture(t);
  const folder = path.join(codexHome, "pets", "nested-link-pet");
  const outside = path.join(base, "outside-art");
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "atlas.webp"), webpVpxHeader(1536, 1872));
  fs.writeFileSync(path.join(folder, "pet.json"), JSON.stringify({
    displayName: "Nested Link",
    spritesheetPath: "art/atlas.webp",
  }));
  try {
    fs.symlinkSync(outside, path.join(folder, "art"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`directory symlink unavailable: ${error.code ?? error.message}`);
    return;
  }
  const listing = listCompanionPets(environment);
  assert.equal(listing.sources.some((pet) => pet.id === "nested-link-pet"), false);
  const diagnostic = listing.diagnostics.find((item) => item.id === "nested-link-pet");
  assert.match(diagnostic.message, /symbolic links/);
});

test("rejects a symlinked install root instead of writing through it", (t) => {
  const { base, codexHome, environment } = fixture(t);
  writeSourcePet(codexHome, { id: "root-link-fox" });
  const installRoot = getPioraPetsDirectory(environment);
  const outside = path.join(base, "outside-install-root");
  fs.mkdirSync(path.dirname(installRoot), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  try {
    fs.symlinkSync(outside, installRoot, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`directory symlink unavailable: ${error.code ?? error.message}`);
    return;
  }
  assert.throws(
    () => importCodexPet("root-link-fox", environment),
    (error) => error instanceof CompanionPetError && error.code === "PET_ACCESS_DENIED",
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("rejects a symlinked destination without touching the linked directory", (t) => {
  const { base, codexHome, environment } = fixture(t);
  writeSourcePet(codexHome, { id: "destination-link-fox" });
  const installRoot = getPioraPetsDirectory(environment);
  const destination = path.join(installRoot, "destination-link-fox");
  const outside = path.join(base, "outside-destination");
  fs.mkdirSync(installRoot, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "sentinel.txt"), "do not touch");
  try {
    fs.symlinkSync(outside, destination, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`directory symlink unavailable: ${error.code ?? error.message}`);
    return;
  }
  assert.throws(
    () => importCodexPet("destination-link-fox", environment),
    (error) => error instanceof CompanionPetError && error.code === "PET_ACCESS_DENIED",
  );
  assert.equal(fs.readFileSync(path.join(outside, "sentinel.txt"), "utf8"), "do not touch");
});
