import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listSource = await readFile(new URL("./TaskList.tsx", import.meta.url), "utf8");
const rowSource = await readFile(new URL("./TaskRow.tsx", import.meta.url), "utf8");
const rowStyles = await readFile(new URL("./TaskRow.module.css", import.meta.url), "utf8");
const menuSource = await readFile(new URL("./TaskContextMenu.tsx", import.meta.url), "utf8");
const sidebarSource = [
  await readFile(new URL("../SessionSidebar.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./SidebarFooter.tsx", import.meta.url), "utf8"),
].join("\n");

test("pins active tasks and removes archived tasks from the project sidebar", () => {
  assert.match(listSource, /compareFlags/);
  assert.match(listSource, /withoutArchivedNodes/);
  assert.match(listSource, /if \(flags\[node\.session\.id\]\?\.archived\) return children/);
  assert.doesNotMatch(listSource, /sidebar\.archivedTasks|archivedOpen/);
});

test("provides the complete task context menu", () => {
  for (const key of ["pinTask", "rename", "archiveTask", "duplicateTask", "copySessionPath", "revealSession", "delete"]) {
    assert.match(menuSource, new RegExp(`sidebar\\.${key}`));
  }
  assert.match(rowSource, /onContextMenu=/);
});

test("keeps AI title optimization inside the Codex-style rename editor", () => {
  assert.match(rowSource, /readSessionTitlePrompt/);
  assert.match(rowSource, /apply: false/);
  assert.match(rowSource, /currentTitle: renameValue\.trim\(\) \|\| title/);
  assert.match(rowSource, /styles\.renameEditor/);
  assert.match(rowSource, /styles\.renameAiButton/);
  assert.match(rowSource, /name="sparkles"/);
  assert.doesNotMatch(rowSource, /name=\{optimizingTitle \? "reload" : "robot"\}/);
  assert.match(rowSource, /if \(name === title\) return/);
  assert.ok(rowSource.indexOf("className={styles.renameInput}") < rowSource.indexOf("styles.renameAiButton"));
  assert.match(rowStyles, /\.renameEditor:focus-within/);
  assert.match(rowStyles, /var\(--text-muted\) 52%/);
  assert.doesNotMatch(rowStyles, /\.renameEditor[^}]*border:[^;]*var\(--accent\)/s);
  assert.match(rowStyles, /@keyframes rename-ai-sparkle/);
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
