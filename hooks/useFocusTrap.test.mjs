import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useFocusTrap.ts", import.meta.url), "utf8");

test("focus trap re-queries dynamic controls and loops in both directions", () => {
  assert.match(source, /const focusable = getFocusableElements\(container\)/);
  assert.match(source, /event\.shiftKey[\s\S]*last\.focus/);
  assert.match(source, /current === last[\s\S]*first\.focus/);
});

test("focus trap handles Escape and restores the opening focus", () => {
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /previouslyFocused\?\.isConnected/);
  assert.match(source, /previouslyFocused\.focus/);
});
