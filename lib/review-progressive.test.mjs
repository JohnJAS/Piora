import assert from "node:assert/strict";
import test from "node:test";
import { getReviewListWindow, REVIEW_LIST_PAGE_SIZE } from "./review-progressive.ts";

test("bounds a large Review list to one stable page", () => {
  assert.deepEqual(getReviewListWindow(238, 0), {
    startIndex: 0,
    endIndex: REVIEW_LIST_PAGE_SIZE,
    before: 0,
    after: 238 - REVIEW_LIST_PAGE_SIZE,
  });
});

test("moves the Review window around the selected change", () => {
  assert.deepEqual(getReviewListWindow(238, REVIEW_LIST_PAGE_SIZE), {
    startIndex: REVIEW_LIST_PAGE_SIZE,
    endIndex: REVIEW_LIST_PAGE_SIZE * 2,
    before: REVIEW_LIST_PAGE_SIZE,
    after: 238 - REVIEW_LIST_PAGE_SIZE * 2,
  });
  assert.deepEqual(getReviewListWindow(238, 237), {
    startIndex: REVIEW_LIST_PAGE_SIZE * 3,
    endIndex: 238,
    before: REVIEW_LIST_PAGE_SIZE * 3,
    after: 0,
  });
});

test("normalizes empty, invalid, and custom-size windows", () => {
  assert.deepEqual(getReviewListWindow(0, 10), { startIndex: 0, endIndex: 0, before: 0, after: 0 });
  assert.deepEqual(getReviewListWindow(12, -5), { startIndex: 0, endIndex: 12, before: 0, after: 0 });
  assert.deepEqual(getReviewListWindow(12, 11, 5), { startIndex: 10, endIndex: 12, before: 10, after: 0 });
});
