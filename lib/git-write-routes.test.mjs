import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("all Git write routes use bounded bodies and the shared authorization boundary", () => {
  const shared = fs.readFileSync(new URL("../app/api/git/_shared.ts", import.meta.url), "utf8");
  assert.match(shared, /parseJsonWithinLimit/);
  assert.match(shared, /getAllowedFileRoots/);
  assert.match(shared, /validateGitWritePaths/);
  for (const action of ["stage", "unstage", "revert"]) {
    const source = fs.readFileSync(new URL(`../app/api/git/${action}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /readGitPathsBody/);
    assert.match(source, /gitErrorResponse/);
  }
  const commit = fs.readFileSync(new URL("../app/api/git/commit/route.ts", import.meta.url), "utf8");
  assert.match(commit, /parseJsonWithinLimit/);
  assert.match(commit, /validateGitWritePaths/);
  assert.match(commit, /includeUnstaged/);
  const push = fs.readFileSync(new URL("../app/api/git/push/route.ts", import.meta.url), "utf8");
  assert.match(push, /parseJsonWithinLimit/);
  assert.match(push, /validateGitWritePaths/);
  assert.match(push, /pushGit/);
  const branches = fs.readFileSync(new URL("../app/api/git/branches/route.ts", import.meta.url), "utf8");
  assert.match(branches, /parseJsonWithinLimit/);
  assert.match(branches, /getAllowedFileRoots/);
  assert.match(branches, /isExistingFilePathAllowed/);
  assert.match(branches, /switchGitBranch/);
});
