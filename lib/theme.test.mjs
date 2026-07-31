import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("../hooks/useTheme.ts");
  } catch {
    return import("../hooks/useTheme.ts");
  }
}

const {
  THEME_PRESETS,
  isDarkTheme,
  parseStoredTheme,
  serializeThemePreference,
} = await loadSubject();
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("marks the Dream Skin preset as a bundled UI theme pack", () => {
  assert.equal(THEME_PRESETS.find(({ id }) => id === "dream")?.packId, "codex-dream-skin");
});

test("exposes the built-in theme presets in a stable order", () => {
  assert.deepEqual(THEME_PRESETS.map(({ id }) => id), [
    "light",
    "dark",
    "midnight",
    "forest",
    "dream",
  ]);
});

test("reads legacy plain theme values", () => {
  assert.equal(parseStoredTheme("light"), "light");
  assert.equal(parseStoredTheme("dark"), "dark");
});

test("round-trips the versioned theme preference payload", () => {
  for (const { id } of THEME_PRESETS) {
    assert.equal(parseStoredTheme(serializeThemePreference(id)), id);
  }
});

test("rejects malformed and unknown stored preferences", () => {
  assert.equal(parseStoredTheme(null), null);
  assert.equal(parseStoredTheme("not-json"), null);
  assert.equal(parseStoredTheme('{"theme":"unknown"}'), null);
  assert.equal(parseStoredTheme('{"theme":'), null);
});

test("marks every dark palette, including custom presets, as dark", () => {
  assert.equal(isDarkTheme("light"), false);
  assert.equal(isDarkTheme("dark"), true);
  assert.equal(isDarkTheme("midnight"), true);
  assert.equal(isDarkTheme("forest"), true);
  assert.equal(isDarkTheme("dream"), true);
});

test("keeps the imported Dream palette more specific than generic dark mode", () => {
  const css = readFileSync(resolve(projectRoot, "app/theme-packs/codex-dream-skin.css"), "utf8");
  assert.match(css, /html\.dark\[data-theme=["']dream["']\]\s*\{/);
  assert.doesNotMatch(css, /(?:^|\n)html\[data-theme=["']dream["']\]\s*\{/);
});

test("keeps appearance discoverable from the sidebar and top bar", () => {
  const source = readFileSync(resolve(projectRoot, "components/AppShell.tsx"), "utf8");
  assert.ok((source.match(/openAppearanceSettings\(event\.currentTarget\)/g) ?? []).length >= 2);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /data-theme-id=\{preset\.id\}/);
  assert.match(source, /app-topbar-appearance[\s\S]{0,180}display:\s*"flex"/);
});
