import assert from "node:assert/strict";
import test from "node:test";
import { thinkingPreview } from "./thinking-preview.ts";

test("thinking preview advances only when a new paragraph has a completed first line", () => {
  assert.equal(thinkingPreview("unfinished", true), "");
  assert.equal(thinkingPreview("**Inspect files**\n\nChecking", true), "Inspect files");
  assert.equal(thinkingPreview("**Inspect files**\n\nChecking paths\nMore tokens", true), "Checking paths");
  assert.equal(thinkingPreview("**Inspect files**\n\nChecking paths\nMore tokens"), "Inspect files");
  assert.equal(thinkingPreview("\r\n# New section\r\nDetails", true), "New section");
  assert.equal(thinkingPreview(""), "");
});
