import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [sidebar, sidebarNavigation, settings, settingsCss, rightPanel, workspaceCss, shell, desktopMain, preload, commands] = await Promise.all([
  readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
  readFile(new URL("./sidebar/SidebarNavigation.tsx", import.meta.url), "utf8"),
  readFile(new URL("./SettingsDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("./SettingsDialog.module.css", import.meta.url), "utf8"),
  readFile(new URL("./workspace/RightPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("./workspace/WorkspacePanel.module.css", import.meta.url), "utf8"),
  readFile(new URL("./AppShell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../desktop/src/main.ts", import.meta.url), "utf8"),
  readFile(new URL("../desktop/src/preload.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/commands.ts", import.meta.url), "utf8"),
]);

test("the sidebar keeps task state in Projects without a duplicate Activity feed", () => {
  assert.doesNotMatch(sidebar, /SidebarActivity|sidebar\.activity/);
  assert.doesNotMatch(sidebarNavigation, /onOpenPlugins|onOpenSkills/);
  assert.match(sidebarNavigation, /onOpenSettings/);
});

test("settings expose four primary categories with contextual subsections", () => {
  assert.match(settings, /labelKey: "settings\.agent"/);
  assert.match(settings, /labelKey: "settings\.extensions"/);
  assert.match(settings, /getSettingsParentKey/);
  assert.match(settings, /className=\{`\$\{styles\.subnavigation\}/);
  assert.match(settingsCss, /\.subnavigation/);
  assert.match(settingsCss, /@media \(max-width: 760px\)/);
  assert.match(settingsCss, /@media \(max-width: 520px\)/);
});

test("desktop chrome has one Settings entry and no duplicate Features menu", () => {
  assert.equal((desktopMain.match(/sendMenuAction\("settings"\)/g) ?? []).length, 1);
  assert.doesNotMatch(desktopMain, /app-menu-features|模型设置|技能管理|插件管理|宠物设置/);
  assert.doesNotMatch(shell, /id: "features"/);
  assert.doesNotMatch(preload, /"features"/);
});

test("file lookup stays in Files and the standalone Search tab is removed", () => {
  assert.doesNotMatch(rightPanel, /SearchPanel|workspace-search|"search"/);
  assert.match(shell, /navigate\.searchFiles[\s\S]*?setRightPanelTab\("files"\)/);
  assert.doesNotMatch(commands, /command\("panel\.search"/);
});

test("the command input uses a compact low-contrast focus treatment", () => {
  assert.match(workspaceCss, /\.commandToolbar > input \{[^}]*height: 30px;/);
  assert.match(workspaceCss, /\.commandToolbar > input:focus-visible \{[^}]*var\(--text-muted\) 24%[^}]*var\(--text-muted\) 5%/);
  assert.doesNotMatch(workspaceCss, /\.searchControls > input,\.commandToolbar > input/);
});

test("workspace actions share compact subtle button styling", () => {
  assert.match(workspaceCss, /\.iconAction \{[^}]*width: 28px;/);
  assert.match(workspaceCss, /\.iconAction:focus-visible \{[^}]*outline: 0/);
  assert.match(workspaceCss, /\.primaryAction \{/);
  assert.match(workspaceCss, /\.reviewToolbar button[^}]*min-height: 28px;/);
  assert.match(workspaceCss, /color-mix\(in srgb, var\(--accent\) 36%/);
});
