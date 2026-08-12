import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getTrackedGitLineStats } = await createJiti(import.meta.url).import("./git-line-stats.ts");

test("conversation Git line totals exclude untracked file contents", () => {
  const status = {
    isGitRepository: true,
    repositoryRoot: "C:\\project",
    files: [
      { filePath: "tracked.ts", status: "modified", code: "M", indexStatus: " ", worktreeStatus: "M", additions: 4, deletions: 2 },
      { filePath: "draft.ts", status: "untracked", code: "U", indexStatus: "?", worktreeStatus: "?", additions: 120, deletions: 0 },
    ],
    additions: 124,
    deletions: 2,
  };

  assert.deepEqual(getTrackedGitLineStats(status), { additions: 4, deletions: 2 });
});

test("conversation Git line totals preserve tracked-only server responses", () => {
  const status = {
    isGitRepository: true,
    repositoryRoot: "C:\\project",
    files: [
      { filePath: "draft.ts", status: "untracked", code: "U", indexStatus: "?", worktreeStatus: "?", additions: 0, deletions: 0 },
    ],
    additions: 7,
    deletions: 3,
  };

  assert.deepEqual(getTrackedGitLineStats(status), { additions: 7, deletions: 3 });
});
