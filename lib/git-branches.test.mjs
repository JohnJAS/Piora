import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

test("lists local branches and switches only to an existing branch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-branches-"));
  try {
    const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "-b", "main");
    git("config", "user.email", "piora@example.invalid");
    git("config", "user.name", "Piora Test");
    fs.writeFileSync(path.join(root, "README.md"), "test\n");
    git("add", "README.md");
    git("commit", "-m", "initial");
    git("branch", "review-me");

    const subject = await createJiti(import.meta.url).import("./git-branches.ts");
    const before = await subject.getGitBranches(root);
    assert.equal(before.currentBranch, "main");
    assert.deepEqual(before.branches, ["main", "review-me"]);
    const after = await subject.switchGitBranch(root, "review-me");
    assert.equal(after.currentBranch, "review-me");
    await assert.rejects(() => subject.switchGitBranch(root, "--discard-changes"), /does not exist/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
