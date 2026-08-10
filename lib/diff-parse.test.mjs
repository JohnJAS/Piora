import assert from "node:assert/strict";
import test from "node:test";

const { parseUnifiedDiff } = await import("./diff-parse.ts");

test("parses a standard patch with line numbers", () => {
  const parsed = parseUnifiedDiff("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -2,2 +2,2 @@\n-old\n+new\n same");
  assert.equal(parsed.files[0].status, "modified");
  assert.deepEqual(parsed.files[0].hunks[0].lines.map((line) => [line.kind, line.oldLine, line.newLine]), [
    ["removed", 2, null], ["added", null, 2], ["context", 3, 3],
  ]);
});

test("recognizes a new file", () => {
  const parsed = parseUnifiedDiff("diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+hello");
  assert.equal(parsed.files[0].status, "added");
  assert.equal(parsed.files[0].newPath, "new.ts");
});

test("recognizes a deleted file", () => {
  const parsed = parseUnifiedDiff("diff --git a/old.ts b/old.ts\ndeleted file mode 100644\n--- a/old.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old");
  assert.equal(parsed.files[0].status, "deleted");
});

test("recognizes a rename without hunks", () => {
  const parsed = parseUnifiedDiff("diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts");
  assert.equal(parsed.files[0].status, "renamed");
  assert.equal(parsed.files[0].oldPath, "old.ts");
  assert.equal(parsed.files[0].newPath, "new.ts");
});

test("recognizes binary patches", () => {
  const parsed = parseUnifiedDiff("diff --git a/a.png b/a.png\nBinary files a/a.png and b/a.png differ");
  assert.equal(parsed.binary, true);
  assert.equal(parsed.files[0].status, "binary");
});

test("normalizes CRLF input", () => {
  const parsed = parseUnifiedDiff("--- a/a.txt\r\n+++ b/a.txt\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\n");
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].hunks[0].lines[1].text, "new");
});

test("counts visible no-newline markers in the render budget", () => {
  const parsed = parseUnifiedDiff("--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file");
  assert.equal(parsed.lineCount, 3);
  assert.equal(parsed.files[0].hunks[0].lines.at(-1)?.kind, "meta");
});
