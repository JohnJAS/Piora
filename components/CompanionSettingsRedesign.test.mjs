import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./CompanionSettingsDialog.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("./CompanionSettingsDialog.module.css", import.meta.url), "utf8");
const store = await readFile(new URL("../lib/companion-store.ts", import.meta.url), "utf8");
const bundledRoot = new URL("../public/companion-pets/bundled/", import.meta.url);
const expectedBundledIds = [
  "azure",
  "corgi-scout",
  "fox",
  "patchi",
  "pekka-pal.codex-pet",
  "penguin",
  "professor-hoot",
  "rabbit",
  "shadow-kit",
];

test("pet studio previews the selected companion with live idle motion", () => {
  assert.match(source, /<SpritePet pet=\{pet\} status="idle"/);
  assert.match(source, /<PetPreview pet=\{selectedPet\} large/);
  assert.match(styles, /\.petPreviewMotion/);
  assert.match(styles, /@keyframes petLivePulse/);
  assert.doesNotMatch(styles, /repeating-linear-gradient/);
});

test("pet import has one ZIP picker and accepts drag-and-drop", () => {
  assert.equal(source.match(/type="file"/g)?.length, 1);
  assert.match(source, /accept="\.zip,application\/zip"/);
  assert.match(source, /onDragEnter=/);
  assert.match(source, /onDragOver=/);
  assert.match(source, /onDrop=/);
  assert.match(source, /event\.dataTransfer\.files\[0\]/);
  assert.match(source, /importArchive\(file\)/);
});

test("the packaged gallery contains nine sprite pets plus the built-in Piora Bot", async () => {
  const entries = await readdir(bundledRoot, { withFileTypes: true });
  const bundledIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(bundledIds, expectedBundledIds);

  for (const id of bundledIds) {
    const manifest = JSON.parse(await readFile(new URL(`${id}/pet.json`, bundledRoot), "utf8"));
    assert.equal(manifest.id, id);
    assert.match(manifest.spritesheetPath, /\.(?:png|webp)$/i);
    assert.ok((await stat(new URL(`${id}/${manifest.spritesheetPath}`, bundledRoot))).size > 0);
  }

  assert.ok((await stat(new URL("../public/companion-pets/piora-bot.webp", import.meta.url))).size > 0);
  assert.match(source, /bundledPets\.length \+ 1/);
  assert.match(source, /BUNDLED_PET_IDS\.has\(pet\.id\)/);
  for (const id of expectedBundledIds) assert.match(store, new RegExp(id.replaceAll(".", "\\.")));
});
