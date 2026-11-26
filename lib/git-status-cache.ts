import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import { createAsyncSnapshotCache } from "./async-snapshot-cache";
import { getGitFileDiff, getGitStatus, invalidateRepositoryRootCache } from "./git-changes";
import type { GitFileDiffResponse, GitStatusResponse } from "./git-types";

declare global {
  var __pioraGitStatusCache: ReturnType<typeof createAsyncSnapshotCache<GitStatusResponse>> | undefined;
  var __pioraGitDiffCache: ReturnType<typeof createAsyncSnapshotCache<GitFileDiffResponse>> | undefined;
}

function cache() { return globalThis.__pioraGitStatusCache ??= createAsyncSnapshotCache<GitStatusResponse>(3_000, 32, 15_000); }
function diffCache() { return globalThis.__pioraGitDiffCache ??= createAsyncSnapshotCache<GitFileDiffResponse>(3_000, 64); }

export function invalidateGitStatusCache() {
  cache().invalidate();
  diffCache().invalidate();
  invalidateRepositoryRootCache();
}

export function getCachedGitStatus(cwd: string) {
  const key = process.platform === "win32" ? resolve(cwd).toLowerCase() : resolve(cwd);
  return cache().get(key, () => getGitStatus(cwd));
}

function diffFileStamp(filePath: string): string {
  try {
    const stat = lstatSync(resolve(filePath), { bigint: true });
    return `${stat.mtimeNs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

export function getCachedGitFileDiff(
  cwd: string,
  filePath: string,
  scope: "combined" | "staged" | "worktree" = "combined",
  contextLines: number | "all" = 3,
): Promise<GitFileDiffResponse> {
  const cwdKey = process.platform === "win32" ? resolve(cwd).toLowerCase() : resolve(cwd);
  const fileKey = process.platform === "win32" ? resolve(filePath).toLowerCase() : resolve(filePath);
  const key = `${cwdKey}|${fileKey}|${scope}|${contextLines}|${diffFileStamp(filePath)}`;
  return diffCache().get(key, () => getGitFileDiff(cwd, filePath, scope, contextLines));
}
