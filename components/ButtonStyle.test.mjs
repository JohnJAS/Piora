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
