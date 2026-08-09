import assert from "node:assert/strict";
import test from "node:test";
import {
  findReopenableFileTab,
  moveFileTab,
  rememberClosedFileTabs,
  tabsAfter,
  tabsExcept,
} from "./file-tabs.ts";

const tabs = [
  { id: "a", isDirty: false },
  { id: "b", isDirty: true },
  { id: "c", isDirty: false },
];

test("moves a file tab to a bounded index without mutating input", () => {
  assert.deepEqual(moveFileTab(tabs, "a", 2).map((tab) => tab.id), ["b", "c", "a"]);
  assert.deepEqual(moveFileTab(tabs, "c", -10).map((tab) => tab.id), ["c", "a", "b"]);
  assert.deepEqual(tabs.map((tab) => tab.id), ["a", "b", "c"]);
});

test("selects tabs to the right or all tabs except the anchor", () => {
  assert.deepEqual(tabsAfter(tabs, "b").map((tab) => tab.id), ["c"]);
  assert.deepEqual(tabsExcept(tabs, "b").map((tab) => tab.id), ["a", "c"]);
  assert.deepEqual(tabsAfter(tabs, "missing"), []);
});

test("keeps a bounded, deduplicated closed-tab history without stale dirty state", () => {
  const history = rememberClosedFileTabs([{ id: "a" }, { id: "old" }], tabs.slice(1), 3);
  assert.deepEqual(history, [
    { id: "c", isDirty: false },
    { id: "b", isDirty: false },
    { id: "a" },
  ]);
});

test("reopens the newest history entry that is not already open", () => {
  assert.equal(findReopenableFileTab([{ id: "a" }, { id: "b" }], [{ id: "a" }])?.id, "b");
  assert.equal(findReopenableFileTab([{ id: "a" }], [{ id: "a" }]), null);
});
