import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const picker = await readFile(new URL("./NewSessionProjectPicker.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const navigation = await readFile(new URL("./sidebar/SidebarNavigation.tsx", import.meta.url), "utf8");
const taskRow = await readFile(new URL("./sidebar/TaskRow.tsx", import.meta.url), "utf8");
const backgrounds = await readFile(new URL("../app/theme-backgrounds.css", import.meta.url), "utf8");
const sidebarCss = await readFile(new URL("./SessionSidebar.module.css", import.meta.url), "utf8");

test("new chat can start without a project while keeping project selection optional", () => {
  assert.match(shell, /const effectiveNewSessionCwd = newSessionCwd;/);
  assert.doesNotMatch(shell, /newSessionCwd \?\? \(selectedSession === null/);
  assert.match(shell, /<NewSessionProjectPicker/);
  assert.match(navigation, /onRequestNewSession\(\)/);
  assert.doesNotMatch(picker, /开始使用 Piora|配置模型|进入“模型”添加并启用模型/);
  assert.match(picker, /<span>选择项目（可选）<\/span>/);
  assert.match(picker, /fetch\(`\/api\/models\$\{query\}`/);
  assert.match(picker, /aria-label="选择模型"/);
  assert.match(picker, /开始新的聊天/);
  assert.match(picker, /不选进入聊天，选择后进入对应项目/);
  assert.match(picker, /Piora 使用步骤/);
  assert.match(picker, /value=\{selectedModelKey\}/);
  assert.match(picker, /<option value="" disabled>/);
  assert.match(picker, /请先选择模型/);
  assert.match(picker, /disabled=\{!selectedModel\}/);
  assert.match(picker, /onStartChat\(getLandingDraft\(\), model\)/);
  assert.match(picker, /defaultModel\?: SelectedModel/);
  assert.match(picker, /const preferred = data\.defaultModel/);
  assert.match(picker, /const first = nextModels\[0\]/);
  assert.match(picker, /重新加载/);
  assert.match(picker, /检查模型设置/);
  assert.match(shell, /onOpenModelSettings=\{\(\) => openSettings\("models"\)\}/);
  assert.match(picker, /不使用项目，直接聊天/);
  assert.match(shell, /fetch\("\/api\/chat-workspace"/);
  assert.match(shell, /newSessionInitialModel=\{newSessionInitialModel\}/);
  assert.doesNotMatch(picker, /你想在|中构建什么|本地/);
  assert.match(picker, /fetch\("\/api\/sessions"/);
  assert.match(picker, /className=\{styles\.composer\}/);
  assert.match(picker, /className=\{styles\.projectPopover\}/);
  assert.match(picker, /setDraft\(`new:\$\{choice\.cwd\}`/);
  assert.match(picker, /LARGE_PASTE_CHARACTER_THRESHOLD/);
  assert.match(picker, /setPastedMaterials/);
  assert.match(picker, /展开编辑/);
  assert.match(picker, /files: pastedMaterials/);
  assert.match(shell, /pendingLandingDraftRef/);
  assert.match(shell, /setDraft\(`new:\$\{cwd\}`/);
  assert.match(picker, /const \[menuOpen, setMenuOpen\] = useState\(false\)/);
  assert.doesNotMatch(picker, /onFocus=\{\(\) => \{ if \(!menuOpen\) setMenuOpen\(true\); \}\}/);
  assert.match(picker, /选择其他文件夹/);
  assert.doesNotMatch(picker, /brandChip|name="arrowdown"/);
});

test("desktop project browsing delegates to the operating system directory picker", async () => {
  const [projectPickerHook, preload, desktopMain] = await Promise.all([
    readFile(new URL("./sidebar/useProjectPicker.ts", import.meta.url), "utf8"),
    readFile(new URL("../desktop/src/preload.ts", import.meta.url), "utf8"),
    readFile(new URL("../desktop/src/main.ts", import.meta.url), "utf8"),
  ]);
  assert.match(projectPickerHook, /window\.piDesktop\?\.selectDirectory/);
  assert.match(projectPickerHook, /rememberProject\(cwd\); setSelectedCwd\(cwd\); onProjectSelected\?\.\(cwd\)/);
  assert.match(shell, /onBrowse=\{\(draft\) => \{[\s\S]*?pendingLandingDraftRef\.current = draft;[\s\S]*?openProjectPicker\(\)/);
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
  assert.match(backgrounds, /data-app-background-active="true"\] \.sidebar-projects-header \{[\s\S]*?background: transparent/s);
  assert.match(sidebarCss, /\.chatSection \{[\s\S]*?background: transparent/);
});

test("pinned sessions use a passive badge and the dead brand search action is gone", () => {
  assert.match(taskRow, /title=\{t\("sidebar\.pinned"\)\}/);
  assert.match(taskRow, /name="pushpin"/);
  assert.doesNotMatch(taskRow, /data-pinned-actions/);
  const brandActions = navigation.match(/<div className=\{styles\.brandActions\}>([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.doesNotMatch(brandActions, /name="search"/);
  assert.match(brandActions, /name="setting"/);
});
