import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const explorer = readFileSync(new URL("./FileExplorer.tsx", import.meta.url), "utf8");

test("workspace file tabs restore through the existing AppShell state", () => {
  assert.match(shell, /parseWorkspaceContinuity/);
  assert.match(shell, /setFileTabs\(restored\.tabs\)/);
  assert.match(shell, /setActiveFileTabId\(restored\.activeTabId\)/);
  assert.match(shell, /updateWorkspaceContinuity/);
});

test("file tree expansion restores per cwd and survives refreshes", () => {
  assert.match(explorer, /setExpandedPaths\(new Set\(restored\.expandedPaths\)\)/);
  assert.match(explorer, /skipExpandedPersistenceRef/);
  assert.match(explorer, /\{ expandedPaths \}/);
});

test("continuity storage failures do not disable workspace navigation", () => {
  assert.match(shell, /Workspace navigation still works when browser storage is unavailable/);
  assert.match(explorer, /tree remains usable when browser storage is unavailable/);
  assert.match(explorer, /Expansion remains available for the current render when storage fails/);
});
