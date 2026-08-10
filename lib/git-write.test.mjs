import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  commitGit,
  computeGitDiffHash,
  GitWriteError,
  revertGitPaths,
  stageGitPaths,
  unstageGitPaths,
  validateGitWritePaths,
} from "./git-write.ts";
import { parseUnifiedDiff } from "./diff-parse.ts";
import { buildPatchForHunk } from "./hunk-patch.ts";

function git(cwd, ...args) { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-git-write-"));
  git(root, "init");
  git(root, "config", "user.email", "piora@example.invalid");
  git(root, "config", "user.name", "Piora Test");
  git(root, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(root, "tracked.txt"), "base\n");
  git(root, "add", "tracked.txt"); git(root, "commit", "-m", "initial");
  return root;
}

test("rejects traversal, absolute paths, oversized arrays, and symlink escape", () => {
  const root = createRepository();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "piora-git-outside-"));
  try {
    const roots = new Set([root]);
    assert.throws(() => validateGitWritePaths(root, ["../../etc/passwd"], roots), GitWriteError);
    assert.throws(() => validateGitWritePaths(root, [path.join(root, "tracked.txt")], roots), GitWriteError);
    assert.throws(() => validateGitWritePaths(root, Array.from({ length: 1001 }, (_, index) => `f${index}`), roots), GitWriteError);
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => validateGitWritePaths(root, ["escape/secret.txt"], roots), /Symbolic link escapes/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test("stages, unstages, verifies hashes, reverts, and commits without command interpolation", async () => {
  const root = createRepository();
  try {
    fs.writeFileSync(path.join(root, "tracked.txt"), "changed\n");
    const paths = validateGitWritePaths(root, ["tracked.txt"], new Set([root]));
    await stageGitPaths(root, paths);
    assert.match(git(root, "diff", "--cached", "--name-only"), /tracked\.txt/);
    await unstageGitPaths(root, paths);
    assert.equal(git(root, "diff", "--cached", "--name-only"), "");
    const hash = await computeGitDiffHash(root, paths);
    fs.appendFileSync(path.join(root, "tracked.txt"), "newer\n");
    await assert.rejects(revertGitPaths(root, paths, hash), (error) => error?.code === "stale_diff");
    const freshHash = await computeGitDiffHash(root, paths);
    await revertGitPaths(root, paths, freshHash);
    assert.equal(fs.readFileSync(path.join(root, "tracked.txt"), "utf8").replace(/\r\n/g, "\n"), "base\n");
    fs.writeFileSync(path.join(root, "tracked.txt"), "committed\n");
    await stageGitPaths(root, paths);
    const sha = await commitGit(root, "message with ; && $(no shell)");
    assert.match(sha, /^[a-f0-9]{40}$/);
    assert.equal(git(root, "log", "-1", "--pretty=%B"), "message with ; && $(no shell)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("rejects write operations while the repository has conflicts", async () => {
  const root = createRepository();
  try {
    const main = git(root, "branch", "--show-current");
    git(root, "checkout", "-b", "other");
    fs.writeFileSync(path.join(root, "tracked.txt"), "other\n"); git(root, "commit", "-am", "other");
    git(root, "checkout", main);
    fs.writeFileSync(path.join(root, "tracked.txt"), "main\n"); git(root, "commit", "-am", "main");
    assert.throws(() => git(root, "merge", "other"));
    await assert.rejects(stageGitPaths(root, ["tracked.txt"]), (error) => error?.code === "conflict");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("stages and unstages one selected hunk without touching the other hunk", async () => {
  const root = createRepository();
  try {
    const original = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`);
    fs.writeFileSync(path.join(root, "multi.txt"), `${original.join("\n")}\n`);
    git(root, "add", "multi.txt"); git(root, "commit", "-m", "multi base");
    const changed = [...original]; changed[0] = "first changed"; changed[12] = "last changed";
    fs.writeFileSync(path.join(root, "multi.txt"), `${changed.join("\n")}\n`);
    const fullPatch = git(root, "diff", "--no-color", "--unified=3", "--", "multi.txt");
    const parsed = parseUnifiedDiff(fullPatch);
    assert.equal(parsed.files[0].hunks.length, 2);
    const hunkPatch = buildPatchForHunk(fullPatch, parsed.files[0].hunks[0]);
    const hash = await computeGitDiffHash(root, ["multi.txt"]);
    await stageGitPaths(root, ["multi.txt"], hunkPatch, hash);
    const cached = git(root, "diff", "--cached", "--", "multi.txt");
    const worktree = git(root, "diff", "--", "multi.txt");
    assert.match(cached, /first changed/); assert.doesNotMatch(cached, /last changed/);
    assert.match(worktree, /last changed/); assert.doesNotMatch(worktree, /first changed/);
    const nextHash = await computeGitDiffHash(root, ["multi.txt"]);
    await unstageGitPaths(root, ["multi.txt"], hunkPatch, nextHash);
    assert.equal(git(root, "diff", "--cached", "--name-only"), "");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("git execution is array-based and excludes prohibited destructive commands", () => {
  const source = fs.readFileSync(new URL("./git-write.ts", import.meta.url), "utf8");
  assert.match(source, /spawn\("git", \["-C", cwd, \.\.\.args\]/);
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /reset\s+--hard|clean\s+-fdx|push\s+--force/);
  assert.match(source, /\["commit", "--file=-"\]/);
});
