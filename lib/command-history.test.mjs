import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { filterCommandHistory } = await createJiti(import.meta.url).import("./command-history.ts");

test("command history suggestions rank exact, prefix, token, and substring matches", () => {
  const history = [
    "npm run lint",
    "git status --short",
    "npm test",
    "git diff --stat",
    "status-check",
  ];
  assert.deepEqual(filterCommandHistory(history, "git sta"), ["git status --short", "git diff --stat"]);
  assert.deepEqual(filterCommandHistory(history, "status"), ["status-check", "git status --short"]);
  assert.deepEqual(filterCommandHistory(history, "npm test"), ["npm test"]);
  assert.deepEqual(filterCommandHistory(history, "  "), []);
});

test("command history suggestions preserve recency and stay bounded", () => {
  assert.deepEqual(
    filterCommandHistory(["npm run test", "npm run lint", "npm run dev"], "npm", 2),
    ["npm run test", "npm run lint"],
  );
});
