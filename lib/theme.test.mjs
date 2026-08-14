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

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => {
    const channel = Number.parseInt(value, 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

test("marks the Dream Skin preset as a bundled UI theme pack", () => {
  assert.equal(THEME_PRESETS.find(({ id }) => id === "dream")?.packId, "codex-dream-skin");
});

test("exposes the built-in theme presets in a stable order", () => {
  assert.deepEqual(THEME_PRESETS.map(({ id }) => id), [
    "light",
    "dark",
    "starlight",
    "ivory",
    "doodle",
    "fortune",
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
  assert.equal(isDarkTheme("starlight"), false);
  assert.equal(isDarkTheme("ivory"), false);
  assert.equal(isDarkTheme("doodle"), false);
  assert.equal(isDarkTheme("fortune"), false);
  assert.equal(isDarkTheme("dark"), true);
  assert.equal(isDarkTheme("midnight"), true);
  assert.equal(isDarkTheme("forest"), true);
  assert.equal(isDarkTheme("dream"), true);
});

test("keeps the imported Dream palette more specific than generic dark mode", () => {
  const css = readFileSync(resolve(projectRoot, "public/themes/codex-dream-skin/skin.css"), "utf8");
  assert.match(css, /html\.dark\[data-theme=["']dream["']\]\s*\{/);
  assert.doesNotMatch(css, /(?:^|\n)html\[data-theme=["']dream["']\]\s*\{/);
});

test("keeps appearance discoverable inside the consolidated settings page, but not duplicate menus", () => {
  const source = readFileSync(resolve(projectRoot, "components/AppShell.tsx"), "utf8");
  const settingsSource = readFileSync(resolve(projectRoot, "components/SettingsDialog.tsx"), "utf8");
  const desktopSource = readFileSync(resolve(projectRoot, "desktop/src/main.ts"), "utf8");
  assert.equal((desktopSource.match(/sendMenuAction\("settings"\)/g) ?? []).length, 1);
  assert.doesNotMatch(desktopSource, /sendMenuAction\("appearance"\)/);
  assert.match(settingsSource, /key:\s*"appearance"/);
  assert.match(settingsSource, /onActiveKeyChange\(entry\.key\)/);
  assert.match(source, /appearance:\s*\([\s\S]*?<AppearanceLooks \/>/);
  assert.doesNotMatch(source, /openAppearanceSettings|onOpenAppearance/);
  assert.doesNotMatch(source, /sidebar-user-menu/);
  assert.doesNotMatch(source, /themeBtnRef|app-topbar-appearance/);
  assert.match(settingsSource, /role="dialog"/);
  assert.match(settingsSource, /aria-modal="true"/);
  assert.match(settingsSource, /createPortal/);
  assert.doesNotMatch(source, /appearanceDialogOpen/);
  assert.match(source, /data-theme-id=\{preset\.id\}/);
});

test("offers a wallpaper-free Codex look alongside four local-artwork looks", () => {
  const source = readFileSync(resolve(projectRoot, "components/AppearanceLooks.tsx"), "utf8");
  assert.match(source, /id:\s*"codex"[\s\S]*theme:\s*"dream"[\s\S]*backgroundId:\s*null/);
  assert.match(source, /starlight[\s\S]*aurora-glass/);
  assert.match(source, /ivory[\s\S]*sage-paper/);
  assert.match(source, /doodle[\s\S]*playful-doodle/);
  assert.match(source, /fortune[\s\S]*auspicious-cloud/);
  assert.match(source, /applyBuiltinPreset/);
  assert.match(source, /setNone\(\)/);
  assert.match(source, /data-appearance-look=\{look\.id\}/);
});

test("offers one action that restores every appearance preference", () => {
  const source = readFileSync(resolve(projectRoot, "components/AppearanceResetButton.tsx"), "utf8");
  const shell = readFileSync(resolve(projectRoot, "components/AppShell.tsx"), "utf8");
  assert.match(shell, /<AppearanceResetButton \/>/);
  assert.match(source, /setTheme\("light"\)/);
  assert.match(source, /resetFont\(\)/);
  assert.match(source, /await resetBackground\(\)/);
  assert.match(source, /data-appearance-reset/);
});

test("keeps small text and links readable on every light visual look", () => {
  const css = readFileSync(resolve(projectRoot, "app/globals.css"), "utf8");
  for (const theme of ["starlight", "ivory", "doodle", "fortune"]) {
    const block = css.match(new RegExp(`html\\[data-theme=["']${theme}["']\\]\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
    assert.ok(block, `missing ${theme} theme block`);
    const readToken = (name) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
    const background = readToken("bg");
    const dimText = readToken("text-dim");
    const accent = readToken("accent");
    assert.ok(background && dimText && accent, `missing contrast tokens for ${theme}`);
    assert.ok(contrastRatio(background, dimText) >= 4.5, `${theme} dim text is too faint`);
    assert.ok(contrastRatio(background, accent) >= 4.5, `${theme} accent is too faint`);
  }
});
