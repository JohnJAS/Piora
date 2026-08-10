import assert from "node:assert/strict";
import test from "node:test";
import { getReviewNavigationIndex, isCommitKeyboardShortcut } from "./review-keyboard.ts";

test("moves through Review items without leaving list boundaries", () => {
  assert.equal(getReviewNavigationIndex(1, "ArrowDown", 4), 2);
  assert.equal(getReviewNavigationIndex(3, "ArrowDown", 4), 3);
  assert.equal(getReviewNavigationIndex(1, "ArrowUp", 4), 0);
  assert.equal(getReviewNavigationIndex(0, "ArrowUp", 4), 0);
  assert.equal(getReviewNavigationIndex(2, "Home", 4), 0);
  assert.equal(getReviewNavigationIndex(2, "End", 4), 3);
  assert.equal(getReviewNavigationIndex(2, "Enter", 4), null);
  assert.equal(getReviewNavigationIndex(0, "ArrowDown", 0), null);
});

test("accepts only Ctrl/Cmd+Enter as the commit shortcut", () => {
  const event = { key: "Enter", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(isCommitKeyboardShortcut(event), true);
  assert.equal(isCommitKeyboardShortcut({ ...event, ctrlKey: false, metaKey: true }), true);
  assert.equal(isCommitKeyboardShortcut({ ...event, shiftKey: true }), false);
  assert.equal(isCommitKeyboardShortcut({ ...event, key: " " }), false);
});
