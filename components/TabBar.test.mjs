import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TabBar.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("file tabs support pointer and keyboard reordering through one callback", () => {
  assert.match(source, /draggable/);
  assert.match(source, /onDrop=/);
  assert.match(source, /onMoveTab\(sourceId, index\)/);
  assert.match(source, /event\.shiftKey && event\.key === "F10"/);
  assert.match(source, /files\.moveTabLeft/);
  assert.match(source, /files\.moveTabRight/);
});

test("file tab menu exposes bulk close and reopen without bypassing dirty confirmation", () => {
  assert.match(source, /files\.closeOtherTabs/);
  assert.match(source, /files\.closeTabsToRight/);
  assert.match(source, /files\.reopenClosedTab/);
  assert.match(shellSource, /confirmDiscardFileTabs/);
  assert.match(shellSource, /rememberClosedFileTabs/);
  assert.match(shellSource, /findReopenableFileTab/);
  assert.match(shellSource, /event\.shiftKey \|\| event\.key\.toLowerCase\(\) !== "t"/);
});

test("file tab action menu has menu semantics and complete bilingual labels", () => {
  assert.match(source, /role="menu"/);
  assert.match(source, /role="menuitem"/);
  assert.match(source, /event\.key === "Escape"/);
  for (const locale of ["en", "zh-CN"]) {
    const messages = readFileSync(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
    for (const key of ["tabActions", "moveTabLeft", "moveTabRight", "closeOtherTabs", "closeTabsToRight", "reopenClosedTab"]) {
      assert.match(messages, new RegExp(`"files\\.${key}"`));
    }
  }
});
