import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkspacePath,
  parseWorkspaceContinuity,
  updateWorkspaceContinuity,
  workspaceContinuityStorageKey,
} from "./workspace-continuity.ts";

const root = "X:\\workspace";
const tab = { id: "file:X:\\workspace\\README.md", label: "README.md", filePath: "X:\\workspace\\README.md", cwd: root };

test("uses a stable scoped storage key and Windows-safe containment", () => {
  assert.equal(workspaceContinuityStorageKey(root), workspaceContinuityStorageKey("x:/workspace/"));
  assert.equal(isWorkspacePath(root, "X:\\workspace\\components\\AppShell.tsx"), true);
  assert.equal(isWorkspacePath(root, "X:\\workspace-old\\secret.txt"), false);
  assert.equal(isWorkspacePath(root, "X:\\workspace\\..\\secret.txt"), false);
});

test("round-trips tabs, active tab, and expanded directories", () => {
  const raw = updateWorkspaceContinuity(null, root, {
    tabs: [tab],
    activeTabId: tab.id,
    expandedPaths: ["X:\\workspace\\components"],
  });
  assert.deepEqual(parseWorkspaceContinuity(raw, root), {
    version: 1,
    workspaceRoot: root,
    tabs: [tab],
    activeTabId: tab.id,
    expandedPaths: ["X:\\workspace\\components"],
  });
});

test("merges independent tab and tree updates without clobbering either side", () => {
  const withTabs = updateWorkspaceContinuity(null, root, { tabs: [tab], activeTabId: tab.id });
  const withTree = updateWorkspaceContinuity(withTabs, root, { expandedPaths: ["X:\\workspace\\lib"] });
  const result = parseWorkspaceContinuity(withTree, root);
  assert.equal(result.tabs.length, 1);
  assert.deepEqual(result.expandedPaths, ["X:\\workspace\\lib"]);
});

test("rejects malformed, cross-workspace, duplicate, and oversized state", () => {
  const raw = JSON.stringify({
    version: 1,
    workspaceRoot: root,
    tabs: [tab, tab, { id: "file:Y:\\outside.txt", label: "outside", filePath: "Y:\\outside.txt" }],
    activeTabId: "missing",
    expandedPaths: ["X:\\workspace\\lib", "X:/workspace/lib", "Y:\\outside"],
  });
  const result = parseWorkspaceContinuity(raw, root);
  assert.equal(result.tabs.length, 1);
  assert.equal(result.activeTabId, tab.id);
  assert.deepEqual(result.expandedPaths, ["X:\\workspace\\lib"]);
  assert.deepEqual(parseWorkspaceContinuity("{".repeat(140_000), root).tabs, []);
});
