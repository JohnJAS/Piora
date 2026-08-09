import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkspacePath,
  parseWorkspaceContinuity,
  updateWorkspaceContinuity,
  workspaceContinuityStorageKey,
} from "./workspace-continuity.ts";

const root = "F:\\Piora";
const tab = { id: "file:F:\\Piora\\README.md", label: "README.md", filePath: "F:\\Piora\\README.md", cwd: root };

test("uses a stable scoped storage key and Windows-safe containment", () => {
  assert.equal(workspaceContinuityStorageKey(root), workspaceContinuityStorageKey("f:/piora/"));
  assert.equal(isWorkspacePath(root, "F:\\Piora\\components\\AppShell.tsx"), true);
  assert.equal(isWorkspacePath(root, "F:\\Piora-old\\secret.txt"), false);
  assert.equal(isWorkspacePath(root, "F:\\Piora\\..\\secret.txt"), false);
});

test("round-trips tabs, active tab, and expanded directories", () => {
  const raw = updateWorkspaceContinuity(null, root, {
    tabs: [tab],
    activeTabId: tab.id,
    expandedPaths: ["F:\\Piora\\components"],
  });
  assert.deepEqual(parseWorkspaceContinuity(raw, root), {
    version: 1,
    workspaceRoot: root,
    tabs: [tab],
    activeTabId: tab.id,
    expandedPaths: ["F:\\Piora\\components"],
  });
});

test("merges independent tab and tree updates without clobbering either side", () => {
  const withTabs = updateWorkspaceContinuity(null, root, { tabs: [tab], activeTabId: tab.id });
  const withTree = updateWorkspaceContinuity(withTabs, root, { expandedPaths: ["F:\\Piora\\lib"] });
  const result = parseWorkspaceContinuity(withTree, root);
  assert.equal(result.tabs.length, 1);
  assert.deepEqual(result.expandedPaths, ["F:\\Piora\\lib"]);
});

test("rejects malformed, cross-workspace, duplicate, and oversized state", () => {
  const raw = JSON.stringify({
    version: 1,
    workspaceRoot: root,
    tabs: [tab, tab, { id: "file:C:\\secret.txt", label: "secret", filePath: "C:\\secret.txt" }],
    activeTabId: "missing",
    expandedPaths: ["F:\\Piora\\lib", "F:/Piora/lib", "C:\\Users"],
  });
  const result = parseWorkspaceContinuity(raw, root);
  assert.equal(result.tabs.length, 1);
  assert.equal(result.activeTabId, tab.id);
  assert.deepEqual(result.expandedPaths, ["F:\\Piora\\lib"]);
  assert.deepEqual(parseWorkspaceContinuity("{".repeat(140_000), root).tabs, []);
});
