import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const panel = fs.readFileSync(new URL("./workspace/design-to-harmony/DesignToHarmonyPanel.tsx", import.meta.url), "utf8");
const rightPanel = fs.readFileSync(new URL("./workspace/RightPanel.tsx", import.meta.url), "utf8");
const shell = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("exposes Design to Harmony as a primary right-panel tool and command target", () => {
  assert.match(rightPanel, /id: "design", icon: "workflow"/);
  assert.match(rightPanel, /workspace-design/);
  assert.match(rightPanel, /<DesignToHarmonyPanel/);
  assert.match(shell, /stored === "design"/);
  assert.match(shell, /"panel\.design"/);
});

test("models a complete design document rather than a screenshot upload", () => {
  assert.match(panel, /DesignTreeNodeSummary/);
  assert.match(panel, /DocumentTree/);
  assert.match(panel, /document\.flows/);
  assert.match(panel, /document\.componentSets/);
  assert.match(panel, /document\.variables\.variables/);
  assert.match(panel, /role=\{depth === 0 \? "tree" : "group"\}/);
  assert.match(panel, /role="treeitem"/);
  assert.match(panel, /aria-selected/);
  assert.match(panel, /aria-label=\{copy\("设计检查器"/);
  assert.doesNotMatch(panel, /type="file"/);
  assert.match(panel, /这里不是截图识别/);
});

test("enables read-only multi-scope analysis without exposing generation or apply actions", () => {
  assert.match(panel, /只读访问/);
  assert.match(panel, /selectedScopeIds/);
  assert.match(panel, /onToggleScope/);
  assert.match(panel, /\/api\/design-to-harmony\/runs/);
  assert.match(panel, /分析所选范围/);
  assert.match(panel, /No ArkUI files were generated or written/);
  assert.match(panel, /问题清单/);
  assert.match(panel, /Read-only import is ready/);
  assert.doesNotMatch(panel, /应用到项目/);
});
