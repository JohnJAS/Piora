import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TaskHeader.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./TaskHeader.module.css", import.meta.url), "utf8");

test("renders the four task header slots from shared task status", () => {
  assert.match(source, /useTaskStatus\(/);
  assert.match(source, /STATUS_PRESENTATION\[presentationKey\]/);
  assert.match(source, /styles\.statusSlot/);
  assert.match(source, /styles\.environmentSlot/);
  assert.match(source, /styles\.changesSlot/);
  assert.match(source, /styles\.actions/);
});

test("polls git changes only while a running task is visible", () => {
  assert.match(source, /if \(!active\) return/);
  assert.match(source, /document\.visibilityState !== "visible"/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /3_000/);
});

test("degrades slots in the required narrow-window order without overflow", () => {
  assert.match(css, /overflow:\s*visible/);
  assert.match(css, /@container \(max-width: 640px\)[\s\S]*?\.changesSlot[\s\S]*?display:\s*none/);
  assert.match(css, /@container \(max-width: 520px\)[\s\S]*?\.environmentDetail/);
  assert.match(css, /@container \(max-width: 400px\)[\s\S]*?\.duration/);
});
