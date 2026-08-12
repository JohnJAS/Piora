import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

async function loadSubject() {
  return import("./git-status.ts");
}

test("parses null-delimited Git status entries including renames", async () => {
  const { parseGitPorcelainV1 } = await loadSubject();
  const entries = parseGitPorcelainV1([
    " M components/App.tsx",
    "?? notes.txt",
    "R  src/new-name.ts",
    "src/old-name.ts",
    "",
  ].join("\0"));

  assert.deepEqual(entries, [
    {
      path: "components/App.tsx",
      indexStatus: " ",
      worktreeStatus: "M",
    },
    {
      path: "notes.txt",
      indexStatus: "?",
      worktreeStatus: "?",
    },
    {
      path: "src/new-name.ts",
      originalPath: "src/old-name.ts",
      indexStatus: "R",
      worktreeStatus: " ",
    },
  ]);
});

test("classifies Git status for explorer badges", async () => {
  const { classifyGitStatus } = await loadSubject();
  const classify = (pair) => classifyGitStatus({
    path: "file.ts",
    indexStatus: pair[0],
    worktreeStatus: pair[1],
  });

  assert.deepEqual(classify(" M"), { status: "modified", code: "M" });
  assert.deepEqual(classify("??"), { status: "untracked", code: "U" });
  assert.deepEqual(classify("A "), { status: "added", code: "A" });
  assert.deepEqual(classify("R "), { status: "renamed", code: "R" });
  assert.deepEqual(classify("UU"), { status: "conflict", code: "C" });
  assert.deepEqual(classify(" D"), { status: "deleted", code: "D" });
});

test("status counts exclude every path matched by Git ignore rules", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-git-ignore-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runGit = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });

  runGit("init", "--quiet");
  const inheritedConfig = path.join(root, ".git", "piora-test-global-config");
  fs.writeFileSync(inheritedConfig, "");
  const previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = inheritedConfig;
  t.after(() => {
    if (previousGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGitConfigGlobal;
  });
  runGit("config", "user.email", "tests@example.invalid");
  runGit("config", "user.name", "Piora Tests");
  fs.writeFileSync(path.join(root, ".gitignore"), "ignored/\n*.log\ntracked-ignored.txt\n");
  fs.writeFileSync(path.join(root, "kept.txt"), "before\n");
  fs.writeFileSync(path.join(root, "tracked-ignored.txt"), "before\n");
  runGit("add", ".gitignore", "kept.txt");
  runGit("add", "--force", "tracked-ignored.txt");
  runGit("commit", "--quiet", "-m", "fixture");

  fs.mkdirSync(path.join(root, "ignored"));
  fs.writeFileSync(path.join(root, "ignored", "cache.tmp"), "ignored\n");
  fs.writeFileSync(path.join(root, "debug.log"), "ignored\n");
  fs.writeFileSync(path.join(root, "visible.txt"), "visible\n");
  // Use different byte lengths so Git cannot classify the tracked writes as
  // unchanged when a Windows filesystem reports a coarse timestamp.
  fs.writeFileSync(path.join(root, "kept.txt"), "after with more content\n");
  fs.writeFileSync(path.join(root, "tracked-ignored.txt"), "ignored after with more content\n");

  const alias = `${root}-alias`;
  fs.symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
  t.after(() => fs.rmSync(alias, { recursive: true, force: true }));

  const { getGitStatus } = await createJiti(import.meta.url).import("./git-changes.ts");
  const status = await getGitStatus(alias);
  assert.equal(status.isGitRepository, true);
  assert.deepEqual(
    status.files.map((file) => path.basename(file.filePath)).sort(),
    ["kept.txt", "visible.txt"],
  );
  assert.equal(status.additions, 1);
  assert.equal(status.deletions, 1);
  const untracked = status.files.find((file) => path.basename(file.filePath) === "visible.txt");
  assert.equal(untracked?.status, "untracked");
  assert.equal(untracked?.additions, 0);
  assert.equal(untracked?.deletions, 0);
});

test("status totals exclude untracked file contents", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "piora-git-untracked-stats-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runGit = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });

  runGit("init", "--quiet");
  runGit("config", "user.email", "tests@example.invalid");
  runGit("config", "user.name", "Piora Tests");
  fs.writeFileSync(path.join(root, "tracked.txt"), "before\n");
  runGit("add", "tracked.txt");
  runGit("commit", "--quiet", "-m", "fixture");
  fs.writeFileSync(path.join(root, "tracked.txt"), "after\n");
  fs.writeFileSync(path.join(root, "untracked.txt"), "one\ntwo\nthree\n");

  const { getGitStatus } = await createJiti(import.meta.url).import("./git-changes.ts");
  const status = await getGitStatus(root);
  assert.equal(status.additions, 1);
  assert.equal(status.deletions, 1);
  assert.deepEqual(
    status.files.map((file) => ({ name: path.basename(file.filePath), additions: file.additions })),
    [
      { name: "tracked.txt", additions: 1 },
      { name: "untracked.txt", additions: 0 },
    ],
  );
});
