import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const api = await createJiti(import.meta.url).import("./markdown-editor-commands.ts");

function apply(doc, edit) { return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to); }

test("inline formatting wraps, selects, and toggles existing Markdown", () => {
  const edit = api.applyMarkdownCommand("hello", { from: 0, to: 5 }, "bold");
  assert.equal(apply("hello", edit), "**hello**");
  assert.deepEqual(edit.selection, { from: 2, to: 7 });
  assert.equal(apply("**hello**", api.applyMarkdownCommand("**hello**", { from: 2, to: 7 }, "bold")), "hello");
});

test("paragraph commands transform every selected line as one undoable edit", () => {
  const doc = "alpha\nbeta\ngamma";
  const edit = api.applyMarkdownCommand(doc, { from: 1, to: 9 }, "task-list");
  assert.equal(apply(doc, edit), "- [ ] alpha\n- [ ] beta\ngamma");
  assert.equal(apply(apply(doc, edit), api.applyMarkdownCommand(apply(doc, edit), edit.selection, "task-list")), doc);
});

test("table commands preserve a valid GFM table while editing rows, columns, and alignment", () => {
  const doc = "before\n| A | B |\n| --- | --- |\n| 1 | 2 |\nafter";
  const context = api.markdownTableAt(doc, doc.indexOf("2"));
  assert.ok(context);
  assert.deepEqual(context.rows, [["A", "B"], ["---", "---"], ["1", "2"]]);
  let edit = api.applyTableCommand(context, "row-after");
  let next = apply(doc, edit);
  assert.match(next, /\| 1 \| 2 \|\n\|  \|  \|/);
  const nextContext = api.markdownTableAt(next, next.indexOf("2"));
  edit = api.applyTableCommand(nextContext, "column-before");
  next = apply(next, edit);
  assert.match(next, /\| A \|  \| B \|/);
  const alignedContext = api.markdownTableAt(next, next.indexOf("2"));
  assert.ok(alignedContext, next);
  const aligned = api.applyTableCommand(alignedContext, "align-center");
  assert.match(apply(next, aligned), /\| --- \| --- \| :---: \|/);
  const cell = api.updateTableCell(alignedContext, 2, 2, "新 | 值\n第二行");
  assert.match(apply(next, cell), /\| 1 \|  \| 新 \\\| 值 第二行 \|/);
});

test("image editing preserves portable Markdown and uses HTML only when width is requested", () => {
  const doc = 'text ![demo](image.png "caption") end';
  const context = api.markdownImageAt(doc, doc.indexOf("image.png"));
  assert.deepEqual({ alt: context.alt, src: context.src, title: context.title, width: context.width }, { alt: "demo", src: "image.png", title: "caption", width: null });
  assert.equal(apply(doc, api.updateMarkdownImage(context, { ...context, width: 320 })), 'text <img src="image.png" alt="demo" title="caption" width="320"> end');
  const html = '<img src="x.png" alt="x" width="800">';
  assert.equal(api.markdownImageAt(html, 5).width, 800);
});
