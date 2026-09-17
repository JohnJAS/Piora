import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { fetchGitRemote, pullGitBranch, gitIntegrationState } = await createJiti(import.meta.url).import("./git-sync.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("fetch and pull update a tracking branch, while ff-only blocks divergence", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "piora-git-sync-"));
  const origin = path.join(temp, "origin.git");
  const first = path.join(temp, "first");
  const second = path.join(temp, "second");
  try {
    git(temp, "init", "--bare", origin);
    fs.mkdirSync(first);
    git(first, "init", "-b", "main");
    git(first, "config", "user.name", "Piora Test");
    git(first, "config", "user.email", "piora@example.invalid");
    fs.writeFileSync(path.join(first, "base.txt"), "base\n");
    git(first, "add", "base.txt"); git(first, "commit", "-m", "base");
    git(first, "remote", "add", "origin", origin);
    git(first, "push", "-u", "origin", "main");
    git(temp, "clone", "-b", "main", origin, second);
    git(second, "config", "user.name", "Piora Test");
    git(second, "config", "user.email", "piora@example.invalid");
    fs.writeFileSync(path.join(first, "remote.txt"), "remote\n");
    git(first, "add", "remote.txt"); git(first, "commit", "-m", "remote"); git(first, "push");
    await fetchGitRemote(second, "origin");
    assert.equal(git(second, "rev-parse", "origin/main"), git(first, "rev-parse", "HEAD"));
    await pullGitBranch(second, "origin", "main", "ff-only");
    assert.equal(git(second, "rev-parse", "HEAD"), git(first, "rev-parse", "HEAD"));
    fs.writeFileSync(path.join(first, "remote2.txt"), "remote 2\n");
    git(first, "add", "remote2.txt"); git(first, "commit", "-m", "remote 2"); git(first, "push");
    fs.writeFileSync(path.join(second, "local.txt"), "local\n");
    git(second, "add", "local.txt"); git(second, "commit", "-m", "local");
    await assert.rejects(pullGitBranch(second, "origin", "main", "ff-only"));
    await pullGitBranch(second, "origin", "main", "rebase");
    assert.equal(git(second, "merge-base", "--is-ancestor", git(first, "rev-parse", "HEAD"), "HEAD"), "");
    assert.equal(await gitIntegrationState(second), null);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
