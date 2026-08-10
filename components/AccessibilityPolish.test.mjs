import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [shell, approval, styles] = await Promise.all([
  readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  readFile(new URL("./ApprovalCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
]);

test("offers a keyboard skip link to the primary workspace", () => {
  assert.match(shell, /href="#piora-main-content"/);
  assert.match(shell, /id="piora-main-content" role="main" tabIndex=\{-1\}/);
  assert.match(styles, /\.skip-to-content:focus-visible/);
});

test("approval is an announced, focus-trapped alert dialog with the safe action focused", () => {
  assert.match(approval, /useFocusTrap\(dialogRef, true, \{ initialFocus: rejectButtonRef, onEscape: reject \}\)/);
  assert.match(approval, /role="alertdialog"/);
  assert.match(approval, /aria-describedby="approval-card-summary approval-card-reason approval-card-keyboard"/);
  assert.match(approval, /ref=\{rejectButtonRef\}/);
  assert.match(approval, /aria-keyshortcuts="Escape"/);
});

test("the global reduced-motion mode disables non-essential transitions and animations", () => {
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /animation-duration: 0\.01ms !important/);
  assert.match(styles, /transition-duration: 0\.01ms !important/);
});
