import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./font-preferences.ts");
  } catch {
    return import("./font-preferences.ts");
  }
}

const subject = await loadSubject();
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function collectUiSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectUiSourceFiles(path);
    return /\.(?:tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

test("exposes only the bundled and Windows-safe font preset allow-list", () => {
  assert.deepEqual(subject.UI_FONT_PRESETS.map(({ id }) => id), [
    "system",
    "inter",
    "yahei",
    "dengxian",
    "simsun",
    "kaiti",
    "consolas",
  ]);
  assert.deepEqual(subject.UI_FONT_SIZES, [12, 14, 16, 18, 20, 24, 28, 32]);
  assert.equal(subject.UI_FONT_SIZE_MIN, 10);
  assert.equal(subject.UI_FONT_SIZE_MAX, 48);
});

test("normalizes malformed font preferences to the Codex baseline", () => {
  assert.deepEqual(subject.parseStoredFontPreference(null), subject.DEFAULT_FONT_PREFERENCE);
  assert.deepEqual(subject.parseStoredFontPreference("not json"), subject.DEFAULT_FONT_PREFERENCE);
  assert.deepEqual(
    subject.parseStoredFontPreference(JSON.stringify({ family: "url(https://example.com)", size: 99 })),
    subject.DEFAULT_FONT_PREFERENCE,
  );
});

test("round-trips every allowed family and size", () => {
  const sizes = [...subject.UI_FONT_SIZES, subject.UI_FONT_SIZE_MIN, 17, subject.UI_FONT_SIZE_MAX];
  for (const { id } of subject.UI_FONT_PRESETS) {
    for (const size of sizes) {
      const preference = { schemaVersion: 1, family: id, size };
      assert.deepEqual(
        subject.parseStoredFontPreference(subject.serializeFontPreference(preference)),
        preference,
      );
    }
  }
});

test("accepts whole-pixel custom sizes only inside the supported range", () => {
  for (const size of [10, 17, 33, 48]) assert.equal(subject.isUiFontSize(size), true);
  for (const size of [9, 48.5, 49, "17", null]) assert.equal(subject.isUiFontSize(size), false);
});

test("applies fonts through static data attributes without restoring CSS zoom", () => {
  const css = readFileSync(resolve(projectRoot, "app/globals.css"), "utf8");
  const appShell = readFileSync(resolve(projectRoot, "components/AppShell.tsx"), "utf8");
  const chatInput = readFileSync(resolve(projectRoot, "components/ChatInput.tsx"), "utf8");

  assert.match(subject.FONT_PREFERENCE_INITIALIZATION_SCRIPT, /data-ui-font/);
  assert.match(subject.FONT_PREFERENCE_INITIALIZATION_SCRIPT, /data-ui-font-size/);
  assert.match(subject.FONT_PREFERENCE_INITIALIZATION_SCRIPT, /--ui-font-size/);
  assert.match(css, /html\[data-ui-font="inter"\]/);
  assert.match(css, /--chat-font-size:\s*var\(--ui-font-size\)/);
  assert.match(css, /--font-mono:\s*var\(--ui-font-family\)/);
  assert.match(css, /--font-code-family:/);
  assert.match(css, /pre, code\s*\{[^}]*var\(--font-code-family\)/s);
  assert.match(readFileSync(resolve(projectRoot, "components/FileEditor.module.css"), "utf8"), /\.textarea\s*\{[^}]*var\(--font-code-family\)/s);
  assert.doesNotMatch(css, /\.app-shell\s*\{[^}]*\bzoom\s*:/s);
  assert.match(appShell, /<FontSettings\s*\/>/);
  assert.match(chatInput, /fontSize:\s*"var\(--chat-font-size\)"/);
});

test("derives typography in every UI component from the user font scale", () => {
  const fixedInlineSize = /\bfontSize\s*:\s*(?:\d+(?:\.\d+)?|["'`][^"'`]*\d+(?:\.\d+)?px[^"'`]*["'`])/;
  const fixedCssSize = /(?<!-)\bfont-size\s*:\s*\d+(?:\.\d+)?px\b/;
  const fixedTailwindSize = /\btext-\[\d+(?:\.\d+)?px\]/;

  for (const path of collectUiSourceFiles(resolve(projectRoot, "components"))) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, fixedInlineSize, `${path} has a fixed inline font size`);
    assert.doesNotMatch(source, fixedCssSize, `${path} has a fixed CSS font size`);
    assert.doesNotMatch(source, fixedTailwindSize, `${path} has a fixed Tailwind font size`);
  }

  const css = readFileSync(resolve(projectRoot, "app/globals.css"), "utf8");
  assert.match(css, /html,\s*body\s*\{[^}]*font-size:\s*var\(--ui-font-size\)/s);
  assert.match(css, /--font-xs:\s*[0-9.]+rem/);
  assert.match(css, /--font-sm:\s*[0-9.]+rem/);
  assert.match(css, /--font-md:\s*[0-9.]+rem/);
  assert.doesNotMatch(css, fixedCssSize);
  assert.doesNotMatch(css, fixedTailwindSize);
});
