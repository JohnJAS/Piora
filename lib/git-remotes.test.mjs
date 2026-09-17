import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { addGitRemote, changeGitRemote, listGitRemotes, previewGitPush, pushGitToRemote, removeGitRemote } = await createJiti(import.meta.url).import("./git-remotes.ts");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("previews explicit destinations and only pushes the chosen remote branch", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "piora-push-preview-"));
  const local = path.join(temp, "local");
  const one = path.join(temp, "one.git");
  const two = path.join(temp, "two.git");
  try {
    fs.mkdirSync(local);
    git(local, "init", "-b", "main");
    git(local, "config", "user.name", "Piora Test");
    git(local, "config", "user.email", "piora@example.invalid");
    fs.writeFileSync(path.join(local, "README.md"), "hello\n");
    git(local, "add", "README.md");
    git(local, "commit", "-m", "initial");
    git(temp, "init", "--bare", one);
    git(temp, "init", "--bare", two);
    git(local, "remote", "add", "origin", one);
    git(local, "remote", "add", "mirror", two);

    const remotes = await listGitRemotes(local);
    assert.deepEqual(remotes.map((item) => item.name).sort(), ["mirror", "origin"]);
    const initial = await previewGitPush(local, "mirror", "release");
    assert.equal(initial.remoteHead, null);
    assert.equal(initial.ahead, 1);
    assert.equal(initial.commits[0].subject, "initial");
    await pushGitToRemote(local, initial, true);
    await pushGitToRemote(local, initial, true);
    assert.equal(git(two, "rev-parse", "refs/heads/release"), initial.localHead);
    assert.throws(() => git(one, "rev-parse", "refs/heads/release"));
    assert.equal(git(local, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"), "mirror/release");

    fs.writeFileSync(path.join(local, "README.md"), "second\n");
    git(local, "commit", "-am", "second");
    const stale = await previewGitPush(local, "mirror", "release");
    fs.writeFileSync(path.join(local, "README.md"), "third\n");
    git(local, "commit", "-am", "third");
    await assert.rejects(pushGitToRemote(local, stale, false), (error) => error?.code === "stale_push_preview");
    const fresh = await previewGitPush(local, "mirror", "release");
    assert.equal(fresh.ahead, 2);
    assert.equal(fresh.behind, 0);
    await pushGitToRemote(local, fresh, false);
    assert.equal(git(two, "rev-parse", "refs/heads/release"), fresh.localHead);
    assert.equal((await previewGitPush(local, "mirror", "release")).ahead, 0);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("remote changes reject unsupported transport and unsafe names", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "piora-remote-validation-"));
  try {
    git(temp, "init");
    await assert.rejects(addGitRemote(temp, "--upload-pack", "https://example.com/r.git"), (error) => error?.code === "invalid_remote");
    await assert.rejects(addGitRemote(temp, "origin", "ext::sh -c echo"), (error) => error?.code === "invalid_remote_url");
    await addGitRemote(temp, "origin", "https://example.com/old.git");
    let remotes = await changeGitRemote(temp, "origin", { name: "publish", url: "https://example.com/new.git", pushUrl: "https://example.com/new.git", replacePushUrl: "https://example.com/old.git" });
    assert.equal(remotes[0].name, "publish");
    assert.deepEqual(remotes[0].fetchUrls, ["https://example.com/new.git"]);
    assert.deepEqual(remotes[0].pushUrls, ["https://example.com/new.git"]);
    remotes = await removeGitRemote(temp, "publish");
    assert.deepEqual(remotes, []);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
