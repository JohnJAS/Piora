import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const picker = await readFile(new URL("./NewSessionProjectPicker.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const navigation = await readFile(new URL("./sidebar/SidebarNavigation.tsx", import.meta.url), "utf8");
const taskRow = await readFile(new URL("./sidebar/TaskRow.tsx", import.meta.url), "utf8");
const backgrounds = await readFile(new URL("../app/theme-backgrounds.css", import.meta.url), "utf8");

test("new chat requires an explicit project choice instead of inheriting the active cwd", () => {
  assert.match(shell, /const effectiveNewSessionCwd = newSessionCwd;/);
  assert.doesNotMatch(shell, /newSessionCwd \?\? \(selectedSession === null/);
  assert.match(shell, /<NewSessionProjectPicker/);
  assert.match(navigation, /onRequestNewSession\(\)/);
  assert.match(picker, /你想在哪个项目中构建什么/);
  assert.match(picker, /fetch\("\/api\/sessions"/);
});

test("conversation chrome and rooms share the configured background", () => {
  assert.match(backgrounds, /data-app-background-active="true"\] \.app-topbar \{\s*background: transparent/s);
  assert.match(backgrounds, /\.room-workspace-header/);
  assert.match(backgrounds, /\.room-workspace-details/);
});

test("pinned sessions keep a visible pin and the dead brand search action is gone", () => {
  assert.match(taskRow, /pinned \? \(/);
  assert.match(taskRow, /name="pushpin"/);
  const brandActions = navigation.match(/<div className=\{styles\.brandActions\}>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.doesNotMatch(brandActions, /name="search"/);
  assert.match(brandActions, /name="setting"/);
});
