import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all project buttons inherit the Codex-style hover, press, focus, and disabled baseline", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /button:not\(:disabled\):hover[\s\S]*background-image:[\s\S]*color-mix\(in srgb, var\(--text\) 6%/);
  assert.match(css, /button:not\(:disabled\):active[\s\S]*transform:\s*scale\(0\.98\)/);
  assert.match(css, /button:focus-visible[\s\S]*outline:/);
  assert.match(css, /button:disabled[\s\S]*cursor:\s*not-allowed/);
});

test("the shared danger variant retains a filled and contrasting button style", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.ui-button\[data-variant="danger"\]\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--status-failed\) 80%, black\);[^}]*color:\s*#fff/);
  assert.match(css, /\.ui-button\[data-variant="danger"\]:hover:not\(:disabled\)/);
});

test("the shared theme accent does not change neutral primary buttons", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.ui-button\[data-variant="accent"\]\s*\{[^}]*background: var\(--accent\);[^}]*color: var\(--bg\)/);
  assert.match(css, /\.ui-button\[data-variant="accent"\]:hover:not\(:disabled\)\s*\{[^}]*background: var\(--accent-hover\)/);
  assert.match(css, /\.ui-button\[data-variant="primary"\]\s*\{[^}]*background: var\(--btn-primary-bg\)/);
});
