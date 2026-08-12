import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./DiffView.tsx", import.meta.url), "utf8");
const fileViewer = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const messageView = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

test("supports unified and split modes with line numbers and hunk actions", () => {
  assert.match(source, /mode\?: "unified" \| "split"/);
  assert.match(source, /hunkActions\?: \(hunk: Hunk\)/);
  assert.match(source, /line\.oldLine/);
  assert.match(source, /line\.newLine/);
  assert.match(source, /<SplitLines/);
});

test("degrades empty, binary, and very large patches", () => {
  assert.match(source, /DIFF_PROGRESSIVE_THRESHOLD/);
  assert.match(source, /diff\.empty/);
  assert.match(source, /diff\.binary/);
  assert.match(source, /getNextDiffRenderCount/);
  assert.match(source, /progressive|loadMoreRef/);
  assert.doesNotMatch(source, /setShowAll\(true\)/);
});

test("uses syntax highlighting and exposes copy and open-file actions", () => {
  assert.match(source, /react-syntax-highlighter/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /onOpenFile\(displayPath, firstLine\(file\)\)/);
});

test("loads omitted unchanged context instead of treating its bar as a hunk collapse", () => {
  assert.match(source, /onExpandContext\?: \(\) => void/);
  assert.match(source, /hiddenAfter/);
  assert.match(source, /diff\.loadingContext/);
  assert.match(source, /className=\{styles\.contextGap\}/);
});

test("both existing diff surfaces use the shared DiffView", () => {
  assert.match(fileViewer, /import \{ DiffView \} from "\.\/DiffView"/);
  assert.match(fileViewer, /<DiffView patch=\{gitDiff\.patch!\}/);
  assert.match(messageView, /import\("\.\/DiffView"\)/);
  assert.match(messageView, /<DiffView patch=\{diff\.text\} mode="split"/);
  assert.doesNotMatch(messageView, /function SplitPatchView/);
});
