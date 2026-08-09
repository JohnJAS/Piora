import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listSource = await readFile(new URL("./TaskList.tsx", import.meta.url), "utf8");
const rowSource = await readFile(new URL("./TaskRow.tsx", import.meta.url), "utf8");
const menuSource = await readFile(new URL("./TaskContextMenu.tsx", import.meta.url), "utf8");
const sidebarSource = [
  await readFile(new URL("../SessionSidebar.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./SidebarFooter.tsx", import.meta.url), "utf8"),
].join("\n");

test("pins active tasks above the normal list and groups archived tasks", () => {
  assert.match(listSource, /compareFlags/);
  assert.match(listSource, /flags\[node\.session\.id\]\?\.archived/);
  assert.match(listSource, /sidebar\.archivedTasks/);
  assert.match(listSource, /aria-expanded=\{archivedOpen\}/);
});

test("provides the complete task context menu", () => {
  for (const key of ["pinTask", "rename", "archiveTask", "duplicateTask", "copySessionPath", "revealSession", "delete"]) {
    assert.match(menuSource, new RegExp(`sidebar\\.${key}`));
  }
  assert.match(rowSource, /onContextMenu=/);
});

test("focuses task search with Ctrl+Shift+F and highlights matches", () => {
  assert.match(sidebarSource, /event\.ctrlKey && event\.shiftKey/);
  assert.match(sidebarSource, /taskSearchRef\.current\?\.focus\(\)/);
  assert.match(rowSource, /<mark/);
});

test("persists flags through the flags API and offers archive undo", () => {
  assert.match(sidebarSource, /fetch\("\/api\/sessions\/flags"/);
  assert.match(sidebarSource, /const undoArchive/);
  assert.match(sidebarSource, /sidebar\.taskArchived/);
});
