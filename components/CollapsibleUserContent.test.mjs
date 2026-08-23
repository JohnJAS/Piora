import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { previewUserContent, shouldCollapseUserContent } = await jiti.import("../lib/collapsible-content.ts");
const { readFileSync } = await import("node:fs");

test("1,000-line Room content renders a six-line preview with accessible full-content actions", () => {
  const full = Array.from({ length: 1_000 }, (_, index) => `日志 ${index + 1} 🙂`).join("\n");
  const preview = previewUserContent(full);
  assert.equal(preview.split("\n").length, 6);
  assert.equal(preview, full.split("\n").slice(0, 6).join("\n"));
  const hash = createHash("sha256").update(full).digest("hex");
  assert.equal(hash.length, 64);
  const source = readFileSync(new URL("./CollapsibleUserContent.tsx", import.meta.url), "utf8");
  assert.match(source, /展开全文/);
  assert.match(source, /复制全文/);
  assert.match(source, /aria-expanded/);
});

test("collapse thresholds use UTF-8 metadata without truncating the source", () => {
  const exact = "你".repeat(400);
  assert.equal(shouldCollapseUserContent({ truncated: false, lineCount: 1, byteLength: Buffer.byteLength(exact) }), false);
  assert.equal(shouldCollapseUserContent({ truncated: false, lineCount: 9, byteLength: 9 }), true);
});
