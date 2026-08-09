import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rightPanel = fs.readFileSync(new URL("./RightPanel.tsx", import.meta.url), "utf8");
const review = fs.readFileSync(new URL("./ReviewPanel.tsx", import.meta.url), "utf8");
const changeList = fs.readFileSync(new URL("./ChangeList.tsx", import.meta.url), "utf8");
const shell = fs.readFileSync(new URL("../AppShell.tsx", import.meta.url), "utf8");
const sidebar = fs.readFileSync(new URL("../SessionSidebar.tsx", import.meta.url), "utf8");

test("moves files and review into an accessible keyboard-operable right workspace", () => {
  assert.match(rightPanel, /role="tablist"/);
  assert.match(rightPanel, /role="tab"/);
  assert.match(rightPanel, /role="tabpanel"/);
  assert.match(rightPanel, /ArrowLeft/);
  assert.match(rightPanel, /ArrowRight/);
  assert.match(rightPanel, /<FileExplorer/);
  assert.match(rightPanel, /<FileViewer/);
  assert.match(rightPanel, /<CommandPanel/);
  assert.doesNotMatch(rightPanel, /<SearchPanel/);
  assert.match(rightPanel, /"review", "files", "commands"/);
  assert.doesNotMatch(rightPanel, /workspace-search/);
  assert.match(shell, /piora-right-panel-tab/);
  assert.match(shell, /useState<RightPanelTab>\("review"\)/);
  assert.match(shell, /rightPanelTabRestored/);
  assert.doesNotMatch(shell, /useState<RightPanelTab>\(\(\) =>/);
  assert.doesNotMatch(sidebar, /<FileExplorer|<SidebarFileArea/);
});

test("the command panel reuses Pi channels while file lookup stays in Files", () => {
  const commandPanel = fs.readFileSync(new URL("./CommandPanel.tsx", import.meta.url), "utf8");
  assert.match(commandPanel, /piora-command-history-v1/);
  assert.match(commandPanel, /excludeFromContext/);
  assert.match(commandPanel, /controls\.runCommand/);
  assert.match(commandPanel, /Interactive commands|commandPanel\.limit/);
  assert.match(shell, /navigate\.searchFiles[\s\S]*?setRightPanelTab\("files"\)/);
  assert.match(shell, /focusFileSearch/);
});

test("review groups changes, supports keyboard navigation, diff rendering, and safe mutations", () => {
  assert.match(review, /createItems/);
  assert.match(review, /group: "staged"/);
  assert.match(review, /group: "unstaged"/);
  assert.match(review, /group: "untracked"/);
  assert.match(changeList, /event\.altKey/);
  assert.match(review, /<DiffView/);
  assert.match(review, /`\/api\/git\/\$\{action\}`/);
  assert.match(review, /"\/api\/git\/commit"/);
  assert.match(review, /window\.confirm/);
  assert.match(review, /piora:git-status-changed/);
});
