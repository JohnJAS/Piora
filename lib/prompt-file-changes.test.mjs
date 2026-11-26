import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { beginPromptFileChanges, finishPromptFileChanges, readPromptFileChanges, recordPromptFileTouch } = await jiti.import("./prompt-file-changes.ts");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function removeTestDirectory(directory, prefix) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith(prefix));
  await rm(resolved, { recursive: true, force: true });
}

test("records only net changes during a run, including pre-existing edits and cancellations", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "piora-run-files-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(temporary, "agent");
  try {
    const repo = path.join(temporary, "git-workspace");
    await mkdir(repo);
    git(repo, "init", "-q");
    await writeFile(path.join(repo, "existing.md"), "original\n");
    await writeFile(path.join(repo, "deleted.txt"), "delete me\n");
    await writeFile(path.join(repo, "clean.txt"), "clean\n");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=Piora Test", "-c", "user.email=test@example.com", "commit", "-qm", "baseline");

    // An older uncommitted edit is part of the baseline, not this run.
    await writeFile(path.join(repo, "existing.md"), "already dirty\n");
    const identity = { sessionId: "git-session", runId: "run-one" };
    const capture = beginPromptFileChanges(identity, repo);
    await capture.initial;
    await writeFile(path.join(repo, "existing.md"), "changed again\n");
    await writeFile(path.join(repo, "clean.txt"), "changed\n");
    await rm(path.join(repo, "deleted.txt"));
    await writeFile(path.join(repo, "new.txt"), "new\n");
    const result = await finishPromptFileChanges(capture, "aborted");
    assert.equal(result.status, "aborted");
    assert.equal(result.partial, false);
    assert.deepEqual(result.files.map(({ path: file, kind }) => [path.basename(file), kind]).sort(), [
      ["clean.txt", "modified"],
      ["deleted.txt", "deleted"], ["existing.md", "modified"], ["new.txt", "added"],
    ]);
    assert.deepEqual(await readPromptFileChanges(identity.sessionId), result);
    const key = createHash("sha256").update(identity.sessionId).digest("hex");
    const saved = JSON.parse(await readFile(path.join(temporary, "agent", "piora", "prompt-file-changes", `${key}.json`), "utf8"));
    assert.deepEqual(saved, result);

    const unchanged = beginPromptFileChanges({ sessionId: "git-session", runId: "run-two" }, repo);
    await unchanged.initial;
    await writeFile(path.join(repo, "existing.md"), "temporary\n");
    await writeFile(path.join(repo, "existing.md"), "changed again\n");
    const noChange = await finishPromptFileChanges(unchanged, "complete");
    assert.deepEqual(noChange.files, []);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await removeTestDirectory(temporary, "piora-run-files-");
  }
});

test("tracks non-Git workspaces and marks incomplete scans", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "piora-run-plain-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(temporary, "agent");
  try {
    const workspace = path.join(temporary, "workspace");
    await mkdir(workspace);
    await writeFile(path.join(workspace, "notes.md"), "old\n");
    const capture = beginPromptFileChanges({ sessionId: "plain-session", runId: "run-one" }, workspace);
    await capture.initial;
    assert.equal((await readPromptFileChanges("plain-session"))?.status, "running");
    await writeFile(path.join(workspace, "notes.md"), "new\n");
    const result = await finishPromptFileChanges(capture, "complete");
    assert.deepEqual(result.files.map(({ path: file, kind }) => [path.basename(file), kind]), [["notes.md", "modified"]]);
    assert.equal((await readPromptFileChanges("plain-session"))?.status, "complete");

    let deepDirectory = workspace;
    for (let index = 0; index < 10; index++) {
      deepDirectory = path.join(deepDirectory, `level-${index}`);
      await mkdir(deepDirectory);
    }
    const incomplete = beginPromptFileChanges({ sessionId: "plain-session", runId: "run-two" }, workspace);
    await incomplete.initial;
    assert.equal((await finishPromptFileChanges(incomplete, "complete")).partial, true);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await removeTestDirectory(temporary, "piora-run-plain-");
  }
});

test("reports live edits while running and tracks touched gitignored files", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "piora-run-live-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = path.join(temporary, "agent");
  try {
    const repo = path.join(temporary, "git-workspace");
    await mkdir(repo);
    git(repo, "init", "-q");
    await mkdir(path.join(repo, "ignored-dir"));
    await writeFile(path.join(repo, ".gitignore"), "ignored-dir/\n");
    await writeFile(path.join(repo, "tracked.txt"), "before\n");
    await writeFile(path.join(repo, "ignored-dir", "notes.md"), "ignored-before\n");
    git(repo, "add", ".gitignore", "tracked.txt");
    git(repo, "-c", "user.name=Piora Test", "-c", "user.email=test@example.com", "commit", "-qm", "init");

    const capture = beginPromptFileChanges({ sessionId: "live-session", runId: "run-live" }, repo);
    await capture.initial;

    await recordPromptFileTouch("live-session", "ignored-dir/notes.md", repo);
    await writeFile(path.join(repo, "ignored-dir", "notes.md"), "ignored-after\n");
    await writeFile(path.join(repo, "tracked.txt"), "after\n");

    const live = await readPromptFileChanges("live-session");
    assert.equal(live?.status, "running");
    assert.deepEqual(
      live?.files.map(({ path: file, kind }) => [path.basename(file), kind]),
      [["notes.md", "modified"], ["tracked.txt", "modified"]],
    );

    const finished = await finishPromptFileChanges(capture, "complete");
    assert.equal(finished.status, "complete");
    assert.deepEqual(
      finished.files.map(({ path: file, kind }) => [path.basename(file), kind]),
      [["notes.md", "modified"], ["tracked.txt", "modified"]],
    );
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await removeTestDirectory(temporary, "piora-run-live-");
  }
});
