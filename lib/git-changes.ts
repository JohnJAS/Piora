import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";
import type {
  GitFileDiffResponse,
  GitFileStatus,
  GitStatusResponse,
} from "./git-types";
import {
  classifyGitStatus,
  parseGitPorcelainV1,
  type GitPorcelainEntry,
} from "./git-status";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

async function git(cwd: string, args: string[], maxBuffer = GIT_STATUS_MAX_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    const repositoryRoot = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    return repositoryRoot ? resolveExistingPath(repositoryRoot) : null;
  } catch {
    return null;
  }
}

function resolveExistingPath(candidate: string): string {
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function isWithinPath(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readStatusEntries(repositoryRoot: string): Promise<GitPorcelainEntry[]> {
  const output = await git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parseGitPorcelainV1(output);
}

async function readIgnoredPaths(repositoryRoot: string, paths: readonly string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  return new Promise((resolve, reject) => {
    const child = spawn("git", [
      "-C",
      repositoryRoot,
      "check-ignore",
      "--no-index",
      "-z",
      "--stdin",
    ], {
      env: { ...process.env, LC_ALL: "C" },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error("git check-ignore timed out")), GIT_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > GIT_STATUS_MAX_BUFFER) fail(new Error("git check-ignore output is too large"));
    });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", fail);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      // check-ignore exits 1 when none of the supplied paths are ignored.
      if (code !== 0 && code !== 1) {
        reject(new Error(stderr.trim() || `git check-ignore exited with code ${code ?? "unknown"}`));
        return;
      }
      resolve(new Set(stdout.split("\0").filter(Boolean)));
    });
    child.stdin.on("error", fail);
    child.stdin.end(`${paths.join("\0")}\0`);
  });
}

async function readVisibleStatusEntries(repositoryRoot: string): Promise<GitPorcelainEntry[]> {
  const entries = await readStatusEntries(repositoryRoot);
  const ignoredPaths = await readIgnoredPaths(repositoryRoot, entries.map((entry) => entry.path));
  return entries.filter((entry) => !ignoredPaths.has(entry.path));
}

async function readTrackedLineStats(
  repositoryRoot: string,
  cwd: string,
  ignoredPaths: ReadonlySet<string> = new Set(),
): Promise<{ additions: number; deletions: number; byPath: Map<string, { additions: number; deletions: number }> }> {
  const relativeCwd = toGitPath(path.relative(repositoryRoot, cwd));
  const pathspec = relativeCwd || ".";
  try {
    const output = await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--numstat",
      "HEAD",
      "--",
      pathspec,
    ]);
    let additions = 0;
    let deletions = 0;
    const byPath = new Map<string, { additions: number; deletions: number }>();
    for (const line of output.split(/\r?\n/)) {
      if (!line) continue;
      const [added, deleted, filePath] = line.split("\t", 3);
      if (filePath && ignoredPaths.has(filePath)) continue;
      const addedCount = Number(added);
      const deletedCount = Number(deleted);
      if (Number.isInteger(addedCount)) additions += addedCount;
      if (Number.isInteger(deletedCount)) deletions += deletedCount;
      if (filePath) byPath.set(filePath, {
        additions: Number.isInteger(addedCount) ? addedCount : 0,
        deletions: Number.isInteger(deletedCount) ? deletedCount : 0,
      });
    }
    return { additions, deletions, byPath };
  } catch {
    return { additions: 0, deletions: 0, byPath: new Map() };
  }
}

function countUntrackedTextLines(filePath: string): number {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return 0;
    const content = fs.readFileSync(filePath);
    if (hasNullByte(content) || content.length === 0) return 0;
    const text = content.toString("utf8");
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  } catch {
    return 0;
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatusResponse> {
  const resolvedCwd = resolveExistingPath(cwd);
  const repositoryRoot = await findRepositoryRoot(resolvedCwd);
  if (!repositoryRoot) {
    return {
      isGitRepository: false,
      repositoryRoot: null,
      files: [],
      additions: 0,
      deletions: 0,
    };
  }

  const allEntries = await readStatusEntries(repositoryRoot);
  const ignoredPaths = await readIgnoredPaths(repositoryRoot, allEntries.map((entry) => entry.path));
  const entries = allEntries.filter((entry) => !ignoredPaths.has(entry.path));
  const trackedLineStats = await readTrackedLineStats(repositoryRoot, resolvedCwd, ignoredPaths);
  const files = entries.flatMap((entry): GitFileStatus[] => {
    const filePath = path.resolve(repositoryRoot, entry.path);
    if (!isWithinPath(resolvedCwd, filePath)) return [];
    const classified = classifyGitStatus(entry);
    const lineStats = trackedLineStats.byPath.get(entry.path);
    const untrackedLines = classified.status === "untracked" ? countUntrackedTextLines(filePath) : 0;
    return [{
      filePath,
      ...classified,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
      additions: lineStats?.additions ?? untrackedLines,
      deletions: lineStats?.deletions ?? 0,
    }];
  });
  const untrackedAdditions = files.reduce(
    (total, file) => total + (file.status === "untracked" ? countUntrackedTextLines(file.filePath) : 0),
    0,
  );

  return {
    isGitRepository: true,
    repositoryRoot,
    files,
    additions: trackedLineStats.additions + untrackedAdditions,
    deletions: trackedLineStats.deletions,
  };
}

function hasNullByte(content: Buffer): boolean {
  return content.includes(0);
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = !hasTrailingNewline && lines.length > 0
    ? "\n\\ No newline at end of file"
    : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

async function createTrackedFilePatch(
  repositoryRoot: string,
  relativePath: string,
  originalPath?: string,
  scope: "combined" | "staged" | "worktree" = "combined",
): Promise<string | null> {
  const paths = originalPath && originalPath !== relativePath
    ? [originalPath, relativePath]
    : [relativePath];
  try {
    const args = ["diff", "--no-color", "--no-ext-diff", "--unified=3"];
    if (scope === "staged") args.push("--cached");
    else if (scope === "combined") args.push("HEAD");
    args.push("--", ...paths);
    return await git(repositoryRoot, args, TEXT_PREVIEW_MAX_BYTES * 4);
  } catch {
    return null;
  }
}

export async function getGitFileDiff(cwd: string, filePath: string, scope: "combined" | "staged" | "worktree" = "combined"): Promise<GitFileDiffResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot || !isWithinPath(repositoryRoot, filePath)) return { supported: false };

  const resolvedFilePath = path.resolve(filePath);
  const relativePath = toGitPath(path.relative(repositoryRoot, resolvedFilePath));
  const entries = await readVisibleStatusEntries(repositoryRoot);
  const entry = entries.find((candidate) => candidate.path === relativePath);
  if (!entry) return { supported: false };

  const { status } = classifyGitStatus(entry);
  if (status === "deleted") {
    const patch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath, scope);
    if (!patch?.includes("\n@@ ")) return { supported: false };
    return { supported: true, status, patch };
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolvedFilePath);
  } catch {
    return { supported: false };
  }
  if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false };

  const currentBuffer = fs.readFileSync(resolvedFilePath);
  if (hasNullByte(currentBuffer)) return { supported: false };
  const newContent = currentBuffer.toString("utf8");

  let patch: string;
  if (status === "untracked") {
    patch = createAddedFilePatch(relativePath, newContent);
  } else {
    const trackedPatch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath, scope);
    if (trackedPatch === null) {
      if (status !== "added") return { supported: false };
      patch = createAddedFilePatch(relativePath, newContent);
    } else {
      patch = trackedPatch;
    }
  }

  if (!patch.includes("\n@@ ")) return { supported: false };
  return { supported: true, status, patch };
}
