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
    const created = await subject.createGitBranch(root, "feature/new-chat");
    assert.equal(created.currentBranch, "feature/new-chat");
    assert.deepEqual(created.branches, ["feature/new-chat", "main", "review-me"]);
    await assert.rejects(() => subject.createGitBranch(root, "main"));
    await assert.rejects(() => subject.createGitBranch(root, "--orphan"));
    assert.equal((await subject.getGitBranches(root)).currentBranch, "feature/new-chat");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a new chat worktree starts from the selected ref without switching the source checkout", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "piora-chat-worktree-"));
  const root = path.join(fixture, "repo");
  fs.mkdirSync(root);
  try {
    const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe", encoding: "utf8" }).trim();
    git("init", "-b", "main");
    git("config", "user.email", "piora@example.invalid");
    git("config", "user.name", "Piora Test");
    fs.writeFileSync(path.join(root, "content.txt"), "Main baseline");
    git("add", "content.txt");
    git("commit", "-m", "main baseline");
    git("switch", "-c", "feature");
    fs.writeFileSync(path.join(root, "content.txt"), "Feature baseline");
    git("commit", "-am", "feature baseline");
    fs.writeFileSync(path.join(root, "content.txt"), "Unsaved local work");

    const { addWorktree } = await createJiti(import.meta.url).import("./worktree.ts");
    const worktree = await addWorktree(root, "piora/chat-test", { branch: "main" });
    assert.equal(fs.readFileSync(path.join(worktree.path, "content.txt"), "utf8"), "Main baseline");
    assert.equal(git("branch", "--show-current"), "feature");
    assert.equal(fs.readFileSync(path.join(root, "content.txt"), "utf8"), "Unsaved local work");
    assert.deepEqual(await addWorktree(root, "piora/chat-test", { branch: "main" }), worktree);
    await assert.rejects(() => addWorktree(root, "piora/chat-invalid", { branch: "main~1" }));
    assert.equal(git("branch", "--list", "piora/chat-invalid"), "");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
