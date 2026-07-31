import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./backgrounds.ts");
  } catch {
    return import("./backgrounds.ts");
  }
}

const subject = await loadSubject();
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(projectRoot, "public/themes/dream-backgrounds/manifest.json");
const rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const expectedIds = [
  "aurora-glass",
  "sage-paper",
  "playful-doodle",
  "auspicious-cloud",
  "midnight-nebula",
  "cyber-teal",
  "watercolor-dawn",
  "ink-mountains",
  "wabi-sabi",
  "nordic-ice",
  "synthwave-grid",
  "bioluminescent-ocean",
  "moss-forest",
  "desert-sunset",
  "sakura-mist",
  "art-deco",
  "bauhaus",
  "linen-minimal",
  "rainy-bokeh",
  "celestial-parchment",
];

test("reserves exactly 20 stable original background slots", () => {
  assert.deepEqual(subject.BACKGROUND_PRESETS.map(({ id }) => id), expectedIds);
  assert.equal(new Set(subject.BACKGROUND_PRESETS.map(({ asset }) => asset)).size, 20);
});

test("keeps all 20 completed backgrounds local-only and backed by real assets", () => {
  assert.equal(subject.BACKGROUND_MANIFEST.artworkStatus, "complete");
  assert.deepEqual(subject.BACKGROUND_MANIFEST.security, {
    remoteUrls: false,
    scripts: false,
    html: false,
    runtimeStyleInjection: false,
  });
  for (const preset of subject.BACKGROUND_PRESETS) {
    assert.equal(preset.artworkStatus, "available");
    assert.match(preset.asset, /^\/themes\/dream-backgrounds\/[a-z0-9-]+\.webp$/);
    assert.doesNotMatch(preset.asset, /:\/\//);
    assert.doesNotMatch(preset.fallback, /url\s*\(/i);
    assert.equal(existsSync(resolve(projectRoot, `public${preset.asset}`)), true, `${preset.id} is marked available without an asset`);
  }
});

test("rejects remote assets and CSS URL injection in manifests", () => {
  const remote = structuredClone(rawManifest);
  remote.presets[0].asset = "https://example.com/background.webp";
  assert.throws(() => subject.parseBackgroundManifest(remote), /Invalid bundled background preset/);

  const injected = structuredClone(rawManifest);
  injected.presets[0].fallback = "url(https://example.com/tracker.png)";
  assert.throws(() => subject.parseBackgroundManifest(injected), /Invalid bundled background preset/);
});

test("normalizes saved preferences and rejects unknown preset ids", () => {
  assert.deepEqual(subject.parseStoredBackgroundPreference(null), subject.DEFAULT_BACKGROUND_PREFERENCE);
  assert.deepEqual(subject.parseStoredBackgroundPreference("not json"), subject.DEFAULT_BACKGROUND_PREFERENCE);
  assert.deepEqual(
    subject.parseStoredBackgroundPreference(JSON.stringify({
      schemaVersion: 1,
      source: "builtin",
      presetId: "aurora-glass",
      overlay: 999,
      blur: -12,
    })),
    { schemaVersion: 1, source: "builtin", presetId: "aurora-glass", overlay: 90, blur: 0 },
  );
  assert.equal(subject.parseStoredBackgroundPreference(JSON.stringify({
    source: "builtin",
    presetId: "not-a-real-slot",
  })).source, "none");
});

test("detects only supported raster signatures", () => {
  assert.equal(subject.detectBackgroundImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(subject.detectBackgroundImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(subject.detectBackgroundImageMime(new TextEncoder().encode("RIFF0000WEBP")), "image/webp");
  assert.equal(subject.detectBackgroundImageMime(new TextEncoder().encode("0000ftypavif0000")), "image/avif");
  assert.equal(subject.detectBackgroundImageMime(new TextEncoder().encode("<svg><script>")), null);
});

test("accepts only bounded local raster data URLs for the storage fallback", () => {
  assert.equal(subject.isSafeCustomBackgroundDataUrl("data:image/png;base64,iVBORw0KGgo="), true);
  assert.equal(subject.isSafeCustomBackgroundDataUrl("https://example.com/image.png"), false);
  assert.equal(subject.isSafeCustomBackgroundDataUrl("data:image/svg+xml;base64,PHN2Zz4="), false);
});
