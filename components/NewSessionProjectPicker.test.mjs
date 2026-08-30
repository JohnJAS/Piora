import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const picker = await readFile(new URL("./NewSessionProjectPicker.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const navigation = await readFile(new URL("./sidebar/SidebarNavigation.tsx", import.meta.url), "utf8");
const taskRow = await readFile(new URL("./sidebar/TaskRow.tsx", import.meta.url), "utf8");
const backgrounds = await readFile(new URL("../app/theme-backgrounds.css", import.meta.url), "utf8");
const sidebarCss = await readFile(new URL("./SessionSidebar.module.css", import.meta.url), "utf8");

test("new chat guides model, project, then conversation in that order", () => {
  assert.match(shell, /const effectiveNewSessionCwd = newSessionCwd;/);
  assert.doesNotMatch(shell, /newSessionCwd \?\? \(selectedSession === null/);
  assert.match(shell, /<NewSessionProjectPicker/);
  assert.match(navigation, /onRequestNewSession\(\)/);
  const modelStep = picker.indexOf("<strong>配置模型</strong>");
  const projectStep = picker.indexOf("<strong>创建或选择项目</strong>");
  const chatStep = picker.indexOf("<strong>开始聊天</strong>");
  assert.ok(modelStep >= 0 && modelStep < projectStep && projectStep < chatStep);
  assert.match(picker, /fetchModelCatalog\(\{/);
  assert.match(picker, /forceRefresh: modelsReloadKey > 0/);
  assert.match(picker, /signal: controller\.signal/);
  assert.match(picker, /controller\.abort\(\)/);
  assert.match(picker, /aria-label="选择模型"/);
  assert.match(picker, /准备好模型和项目，再开始聊天/);
  assert.match(picker, /aria-label="会话准备"/);
  assert.match(picker, /value=\{selectedModelKey\}/);
  assert.match(picker, /<option value="" disabled>/);
  assert.match(picker, /请先选择模型/);
  assert.match(picker, /const \[selectedProject, setSelectedProject\]/);
  assert.match(picker, /disabled=\{!canStartChat\}/);
  assert.match(picker, /onSelect\(selectedProject\.cwd, selectedProject\.root, model\)/);
  assert.match(picker, /const preferred = data\.defaultModel/);
  assert.match(picker, /const first = nextModels\[0\]/);
  assert.match(picker, /if \(nextModels\.length > 0\) setModelSelectionRequired\(false\)/);
  assert.match(picker, /重新加载/);
  assert.doesNotMatch(picker, /检查模型设置|onOpenModelSettings|不使用项目，直接聊天|onStartChat/);
  assert.match(picker, /className=\{styles\.modelNotice\}/);
  assert.match(picker, /className=\{styles\.reloadButton\}/);
  assert.match(picker, /role=\{modelSelectionRequired \|\| projectSelectionRequired \? "alert" : undefined\}/);
  assert.match(shell, /newSessionInitialModel=\{newSessionInitialModel\}/);
  assert.match(picker, /fetch\("\/api\/sessions"/);
  assert.match(picker, /className=\{styles\.composer\}/);
  assert.match(picker, /className=\{styles\.projectPopover\}/);
  assert.match(picker, /setDraft\(`new:\$\{selectedProject\.cwd\}`/);
  assert.match(picker, /LARGE_PASTE_CHARACTER_THRESHOLD/);
  assert.match(picker, /setPastedMaterials/);
  assert.match(picker, /展开编辑/);
  assert.match(picker, /files: pastedMaterials/);
  assert.match(shell, /pendingLandingDraftRef/);
  assert.match(shell, /pendingLandingModelRef/);
  assert.match(shell, /setDraft\(`new:\$\{cwd\}`/);
  assert.match(picker, /const \[menuOpen, setMenuOpen\] = useState\(false\)/);
  assert.doesNotMatch(picker, /onFocus=\{\(\) => \{ if \(!menuOpen\) setMenuOpen\(true\); \}\}/);
  assert.match(picker, /创建或打开其他项目/);
  assert.doesNotMatch(picker, /brandChip/);
});

test("desktop project browsing delegates to the operating system directory picker", async () => {
  const [projectPickerHook, preload, desktopMain] = await Promise.all([
    readFile(new URL("./sidebar/useProjectPicker.ts", import.meta.url), "utf8"),
    readFile(new URL("../desktop/src/preload.ts", import.meta.url), "utf8"),
    readFile(new URL("../desktop/src/main.ts", import.meta.url), "utf8"),
  ]);
  assert.match(projectPickerHook, /window\.piDesktop\?\.selectDirectory/);
  assert.match(projectPickerHook, /rememberProject\(cwd\); setSelectedCwd\(cwd\); onProjectSelected\?\.\(cwd\)/);
  assert.match(shell, /onBrowse=\{\(draft, model\) => \{[\s\S]*?pendingLandingDraftRef\.current = draft;[\s\S]*?pendingLandingModelRef\.current = model;[\s\S]*?openProjectPicker\(\)/);
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
