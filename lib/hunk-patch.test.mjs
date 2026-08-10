import assert from "node:assert/strict";
import test from "node:test";
import { parseUnifiedDiff } from "./diff-parse.ts";
import { buildPatchForHunk } from "./hunk-patch.ts";

test("builds an independently applicable patch from a selected hunk", () => {
  const patch = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -8,2 +8,2 @@\n-x\n+X\n y\n";
  const parsed = parseUnifiedDiff(patch);
  const selected = buildPatchForHunk(patch, parsed.files[0].hunks[1]);
  assert.match(selected, /--- a\/a\.txt/);
  assert.match(selected, /@@ -8,2 \+8,2 @@/);
  assert.doesNotMatch(selected, /@@ -1,2/);
});
