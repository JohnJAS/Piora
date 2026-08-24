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
  assert.match(picker, /开始一个新会话/);
  assert.match(picker, /配置模型/);
  assert.match(picker, /选择项目文件夹/);
  assert.doesNotMatch(picker, /你想在|中构建什么|本地/);
  assert.match(picker, /fetch\("\/api\/sessions"/);
  assert.match(picker, /className=\{styles\.composer\}/);
  assert.match(picker, /className=\{styles\.projectPopover\}/);
  assert.match(picker, /setDraft\(`new:\$\{choice\.cwd\}`/);
  assert.match(picker, /const \[menuOpen, setMenuOpen\] = useState\(false\)/);
  assert.doesNotMatch(picker, /onFocus=\{\(\) => \{ if \(!menuOpen\) setMenuOpen\(true\); \}\}/);
  assert.match(picker, /选择其他文件夹/);
});

test("desktop project browsing delegates to the operating system directory picker", async () => {
  const [projectPickerHook, preload, desktopMain] = await Promise.all([
    readFile(new URL("./sidebar/useProjectPicker.ts", import.meta.url), "utf8"),
    readFile(new URL("../desktop/src/preload.ts", import.meta.url), "utf8"),
    readFile(new URL("../desktop/src/main.ts", import.meta.url), "utf8"),
  ]);
  assert.match(projectPickerHook, /window\.piDesktop\?\.selectDirectory/);
  assert.match(projectPickerHook, /rememberProject\(cwd\); setSelectedCwd\(cwd\); onProjectSelected\?\.\(cwd\)/);
  assert.match(shell, /onBrowse=\{\(\) => sessionSidebarRef\.current\?\.openProjectPicker\(\)\}/);
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /onProjectSelected:\s*handlePickedProject/);
  assert.match(sidebar, /handlePickedProject[\s\S]*?onNewSession\?\.\(createTemporarySessionId\(\), cwd\)/);
  assert.match(preload, /selectDirectory\(\)[\s\S]*pi:directory-picker/);
  assert.match(desktopMain, /DIRECTORY_PICKER_CHANNEL[\s\S]*showOpenDialog[\s\S]*openDirectory/);
});

test("new chat keeps the right workspace toggle available before project selection", () => {
  assert.match(shell, /!settingsDialogOpen && \(\s*<div className="conversation-toolbar-actions">/);
  assert.match(shell, /\{showChat \? \([\s\S]*topbar-changes-button[\s\S]*\) : null\}[\s\S]*right-panel-toggle/);
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
