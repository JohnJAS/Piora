import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { assertUnredirectedPath, assertUnredirectedPathSync } = await jiti.import("./harmony/runtime/path-safety.ts");
const { readBoundedRegularFile, enforceArtifactQuota } = await jiti.import("./harmony/runtime/bounded-file.ts");

test("Windows case and short-name aliases remain usable for bounded artifacts", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "harmony-path-alias-"));
  try {
    const path = join(directory, "Capture.wav");
    await writeFile(path, "pcm");
    assert.equal((await readBoundedRegularFile(path.toUpperCase(), 3)).toString(), "pcm");
    assertUnredirectedPathSync(directory.toUpperCase());
    const shortDirectory = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:PIORA_HARMONY_TEST_DIRECTORY).ShortPath"], {
      encoding: "utf8", windowsHide: true, env: { ...process.env, PIORA_HARMONY_TEST_DIRECTORY: directory },
    }).trim();
    assert.ok(shortDirectory);
    assert.equal((await readBoundedRegularFile(join(shortDirectory, "Capture.wav"), 3)).toString(), "pcm");
    assertUnredirectedPathSync(shortDirectory);
    await enforceArtifactQuota(shortDirectory, "wav", 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("artifact reads and retention reject symlink or junction parents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harmony-path-redirect-"));
  try {
    const actual = join(directory, "actual"), alias = join(directory, "redirect");
    await mkdir(actual);
    await writeFile(join(actual, `${"a".repeat(64)}.wav`), "pcm");
    await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(assertUnredirectedPath(alias), /redirected/);
    assert.throws(() => assertUnredirectedPathSync(alias), /redirected/);
    await assert.rejects(readBoundedRegularFile(join(alias, `${"a".repeat(64)}.wav`), 3), /redirected/);
    await assert.rejects(enforceArtifactQuota(alias, "wav", 0), /redirected/);
    assert.equal((await readBoundedRegularFile(join(actual, `${"a".repeat(64)}.wav`), 3)).toString(), "pcm");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
