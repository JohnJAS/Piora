import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [shell, styles] = await Promise.all([
  readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("offers a keyboard skip link to the primary workspace", () => {
  assert.match(shell, /href="#piora-main-content"/);
  assert.match(shell, /id="piora-main-content" role="main" tabIndex=\{-1\}/);
  assert.match(styles, /\.skip-to-content:focus-visible/);
});

test("the global reduced-motion mode disables non-essential transitions and animations", () => {
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /animation-duration: 0\.01ms !important/);
  assert.match(styles, /transition-duration: 0\.01ms !important/);
});
