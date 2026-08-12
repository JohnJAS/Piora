import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { applyProjectOrder, moveProjectRoot } = await jiti.import("./sidebar/sidebar-utils.ts");
const [sidebar, area, projectList, styles] = await Promise.all([
  readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8"),
  readFile(new URL("./sidebar/SidebarProjectArea.tsx", import.meta.url), "utf8"),
  readFile(new URL("./sidebar/ProjectList.tsx", import.meta.url), "utf8"),
  readFile(new URL("./SessionSidebar.module.css", import.meta.url), "utf8"),
]);

test("applies persisted project order and appends newly discovered projects", () => {
  const projects = [{ root: "new" }, { root: "b" }, { root: "a" }];
  assert.deepEqual(
    applyProjectOrder(projects, ["a", "b"], (project) => project.root).map((project) => project.root),
    ["a", "b", "new"],
  );
});

test("moves a project before or after the hovered project", () => {
  assert.deepEqual(moveProjectRoot(["a", "b", "c"], "a", "c", "before"), ["b", "a", "c"]);
  assert.deepEqual(moveProjectRoot(["a", "b", "c"], "a", "c", "after"), ["b", "c", "a"]);
  assert.deepEqual(moveProjectRoot(["a", "b"], "missing", "b", "after"), ["a", "b"]);
});

test("long-presses project rows to reorder without adding a drag button", () => {
  assert.match(area, /PROJECT_DRAG_HOLD_MS = 250/);
  assert.match(area, /window\.addEventListener\("pointermove"/);
  assert.match(area, /onReorderProjects\(activeDrag\.sourceRoot, activeDrag\.targetRoot, activeDrag\.position\)/);
  assert.match(sidebar, /PROJECT_ORDER_STORAGE_KEY|projectOrder/);
  assert.match(projectList, /data-project-drag-handle/);
  assert.match(projectList, /data-project-drag-ignore/);
  assert.doesNotMatch(projectList, /drag handle|dragHandle|name="drag"/i);
  assert.match(styles, /\.projectDropBefore::before/);
  assert.match(styles, /\.projectDropAfter::after/);
});

test("one project click both selects the project and toggles its folder", () => {
  assert.match(projectList, /onClick=\{\(\) => \{ onSelectProject\(\); onToggleProject\(\); \}\}/);
  assert.doesNotMatch(projectList, /if \(isSelectedProject\) onToggleProject/);
});
