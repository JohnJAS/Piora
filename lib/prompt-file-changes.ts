import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getRuntimeAgentDataDirectory } from "./runtime-home";
import { parseGitPorcelainV1 } from "./git-status";
import type { PromptRunIdentity } from "./prompt-run-registry";

const execFileAsync = promisify(execFile);
const MAX_FILES = 5000;
const MAX_GIT_TRACKED_FILES = 100_000;
const MAX_DEPTH = 8;
const MAX_HASH_BYTES = 128 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 20 * 1024 * 1024;
const LIVE_CACHE_TTL_MS = 1_500;
const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".cache", ".turbo", "vendor", "target", "__pycache__"]);

export interface PromptFileChange {
  path: string;
  kind: "added" | "modified" | "deleted";
}

export interface PromptFileChanges {
  sessionId: string;
  runId: string;
  cwd: string;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "complete" | "aborted" | "error" | "unavailable";
  partial: boolean;
  files: PromptFileChange[];
}

interface Snapshot {
  root: string;
  git: boolean;
  gitHash?: "sha1" | "sha256";
  versions: Map<string, string>;
  dirtyPaths?: Set<string>;
  partial: boolean;
}

export interface PromptFileCapture {
  identity: PromptRunIdentity;
  initial: Promise<Snapshot>;
  initialSettled?: Snapshot;
  startedAt: number;
  cwd: string;
  touchedPaths: Set<string>;
  touchedBaselines: Map<string, string>;
  liveCache?: { at: number; record: PromptFileChanges };
  liveInflight?: Promise<PromptFileChanges>;
}

declare global {
  var __pioraActivePromptFileChanges: Map<string, PromptFileChanges> | undefined;
  var __pioraActivePromptFileCaptures: Map<string, PromptFileCapture> | undefined;
}

function getActive(): Map<string, PromptFileChanges> {
  return globalThis.__pioraActivePromptFileChanges ??= new Map();
}

function getCaptures(): Map<string, PromptFileCapture> {
  return globalThis.__pioraActivePromptFileCaptures ??= new Map();
}

function storagePath(sessionId: string): string {
  const key = createHash("sha256").update(sessionId).digest("hex");
  return path.join(getRuntimeAgentDataDirectory(), "piora", "prompt-file-changes", `${key}.json`);
}

async function persist(record: PromptFileChanges): Promise<void> {
  const target = storagePath(record.sessionId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(record), "utf8");
  try { await fs.rename(temporary, target); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}

function diffSnapshots(before: Snapshot, after: Snapshot, capture: PromptFileCapture): PromptFileChange[] {
  const files: PromptFileChange[] = [];
  for (const file of new Set([...before.versions.keys(), ...after.versions.keys(), ...capture.touchedPaths])) {
    const oldVersion = before.versions.get(file) ?? capture.touchedBaselines.get(file);
    const newVersion = after.versions.get(file);
    if (oldVersion === newVersion) continue;
    if ((oldVersion === undefined || oldVersion === "missing") && (newVersion === undefined || newVersion === "missing")) continue;
    files.push({
      path: file,
      kind: newVersion === undefined || newVersion === "missing"
        ? "deleted"
        : oldVersion === undefined || oldVersion === "missing"
          ? "added"
          : "modified",
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readPromptFileChanges(sessionId: string): Promise<PromptFileChanges | null> {
  const running = getActive().get(sessionId);
  if (running) {
    const capture = getCaptures().get(sessionId);
    if (running.status === "running" && capture?.initialSettled && capture.identity.runId === running.runId) {
      if (capture.liveCache && Date.now() - capture.liveCache.at < LIVE_CACHE_TTL_MS) {
        return capture.liveCache.record;
      }
      if (!capture.liveInflight) {
        capture.liveInflight = (async () => {
          const before = capture.initialSettled!;
          const after = await snapshot(capture.cwd, before, capture.touchedPaths);
          const record: PromptFileChanges = {
            ...running,
            status: "running",
            partial: before.partial || after.partial,
            files: diffSnapshots(before, after, capture),
          };
          if (getActive().get(sessionId)?.runId === running.runId && getActive().get(sessionId)?.status === "running") {
            capture.liveCache = { at: Date.now(), record };
          }
          return record;
        })().catch(() => running).finally(() => {
          capture.liveInflight = undefined;
        });
      }
      return capture.liveInflight;
    }
    return running;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(storagePath(sessionId), "utf8")) as PromptFileChanges;
    if (parsed.sessionId !== sessionId) return null;
    // An in-progress record left on disk after a process restart has no live
    // capture to finish it. Make that gap explicit instead of showing a spinner.
    return parsed.status === "running" ? { ...parsed, status: "unavailable", partial: true } : parsed;
  } catch { return null; }
}

function safeAbsolute(root: string, relative: string): string | null {
  const absolute = path.resolve(root, relative);
  const fromRoot = path.relative(root, absolute);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) return null;
  return absolute;
}

async function fingerprint(file: string, budget: { remaining: number; partial: boolean }, gitHash?: "sha1" | "sha256"): Promise<string> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile()) { budget.partial = true; return "missing"; }
    if (stat.size > MAX_SINGLE_FILE_BYTES || stat.size > budget.remaining) {
      budget.partial = true;
      return `metadata:${stat.size}:${stat.mtimeMs}`;
    }
    budget.remaining -= stat.size;
    const data = await fs.readFile(file);
    return gitHash
      ? `git:${createHash(gitHash).update(`blob ${data.length}\0`).update(data).digest("hex")}`
      : createHash("sha256").update(data).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") budget.partial = true;
    return "missing";
  }
}

async function gitRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 8000 });
    return path.resolve(stdout.trim());
  } catch { return null; }
}

async function gitPaths(root: string): Promise<{ paths: string[]; partial: boolean }> {
  const { stdout } = await execFileAsync("git", ["-C", root, "-c", "status.relativePaths=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"], { timeout: 15000, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" });
  const entries = parseGitPorcelainV1(stdout);
  const paths = [...new Set(entries.flatMap((entry) => [entry.path, ...(entry.originalPath ? [entry.originalPath] : [])]))];
  return { paths: paths.slice(0, MAX_FILES), partial: paths.length > MAX_FILES };
}

async function gitTrackedVersions(root: string): Promise<{ versions: Map<string, string>; partial: boolean }> {
  const { stdout } = await execFileAsync("git", ["-C", root, "ls-files", "--cached", "--stage", "-z"], { timeout: 15000, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" });
  const versions = new Map<string, string>();
  let partial = false;
  for (const entry of stdout.split("\0")) {
    if (!entry) continue;
    const separator = entry.indexOf("\t");
    const header = separator >= 0 ? entry.slice(0, separator) : "";
    const match = /^\d+ ([0-9a-f]{40,64}) ([0-3])$/.exec(header);
    if (!match || separator < 0) { partial = true; continue; }
    const absolute = safeAbsolute(root, entry.slice(separator + 1));
    if (!absolute) continue;
    if (versions.size >= MAX_GIT_TRACKED_FILES && !versions.has(absolute)) { partial = true; break; }
    // A clean tracked file has the index blob as its content baseline. Dirty
    // paths below are replaced with a hash of the actual working file.
    versions.set(absolute, `git:${match[1]}`);
    if (match[2] !== "0") partial = true;
  }
  return { versions, partial };
}

async function gitSnapshot(
  root: string,
  extraPaths: Iterable<string> = [],
  previousDirtyPaths?: ReadonlySet<string>,
): Promise<Snapshot> {
  const [listing, tracked] = await Promise.all([gitPaths(root), gitTrackedVersions(root)]);
  const versions = tracked.versions;
  const gitHash = [...versions.values()].some((version) => version.length === 68) ? "sha256" : "sha1";
  const dirtyPaths = new Set<string>();
  const candidates = new Set<string>();
  for (const relative of listing.paths) {
    const absolute = safeAbsolute(root, relative);
    if (!absolute) continue;
    dirtyPaths.add(absolute);
    candidates.add(absolute);
  }
  for (const raw of extraPaths) {
    const absolute = safeAbsolute(root, raw);
    if (absolute) candidates.add(absolute);
  }
  if (previousDirtyPaths) {
    for (const previous of previousDirtyPaths) candidates.add(previous);
  }
  const budget = { remaining: MAX_HASH_BYTES, partial: listing.partial || tracked.partial || candidates.size > MAX_FILES };
  let hashed = 0;
  for (const absolute of candidates) {
    if (hashed >= MAX_FILES) {
      budget.partial = true;
      break;
    }
    hashed += 1;
    versions.set(absolute, await fingerprint(absolute, budget, gitHash));
  }
  return { root, git: true, gitHash, versions, dirtyPaths, partial: budget.partial };
}

async function plainSnapshot(root: string, extraPaths: Iterable<string> = []): Promise<Snapshot> {
  const versions = new Map<string, string>();
  const budget = { remaining: MAX_HASH_BYTES, partial: false };
  const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const { directory, depth } = queue[index];
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { budget.partial = true; continue; }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) queue.push({ directory: absolute, depth: depth + 1 });
        else budget.partial = true;
      } else if (entry.isFile()) {
        if (versions.size >= MAX_FILES) { budget.partial = true; break; }
        versions.set(absolute, await fingerprint(absolute, budget));
      }
    }
    if (versions.size >= MAX_FILES) break;
  }
  for (const raw of extraPaths) {
    const absolute = safeAbsolute(root, raw);
    if (absolute && !versions.has(absolute)) {
      versions.set(absolute, await fingerprint(absolute, budget));
    }
  }
  return { root, git: false, versions, partial: budget.partial };
}

async function snapshot(cwd: string, initial?: Snapshot, touchedPaths?: ReadonlySet<string>): Promise<Snapshot> {
  const discoveredGitRoot = initial ? null : await gitRoot(cwd);
  const root = initial?.root ?? discoveredGitRoot ?? path.resolve(cwd);
  const git = initial?.git ?? discoveredGitRoot !== null;
  if (git) {
    return gitSnapshot(root, touchedPaths ?? [], initial?.dirtyPaths);
  }
  return plainSnapshot(root, touchedPaths ?? []);
}

export async function recordPromptFileTouch(sessionId: string, rawPath: string, cwd: string): Promise<void> {
  const capture = getCaptures().get(sessionId);
  const active = getActive().get(sessionId);
  if (!capture || !active || active.runId !== capture.identity.runId || active.status !== "running") return;
  const trimmed = rawPath.trim();
  if (!trimmed) return;
  const baseCwd = path.resolve(cwd || capture.cwd);
  const candidate = path.resolve(baseCwd, trimmed);
  const allowedRoot = capture.initialSettled?.root ?? path.resolve(capture.cwd);
  const relativeFromRoot = path.relative(allowedRoot, candidate);
  if (!relativeFromRoot || relativeFromRoot === ".." || relativeFromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFromRoot)) {
    return;
  }
  const firstTouch = !capture.touchedPaths.has(candidate);
  capture.touchedPaths.add(candidate);
  capture.liveCache = undefined;
  if (firstTouch && !capture.touchedBaselines.has(candidate)) {
    const initialSnap = capture.initialSettled ?? await capture.initial.catch(() => undefined);
    const existing = initialSnap?.versions.get(candidate);
    if (existing !== undefined) {
      capture.touchedBaselines.set(candidate, existing);
    } else {
      const baseline = await fingerprint(
        candidate,
        { remaining: MAX_SINGLE_FILE_BYTES, partial: false },
        initialSnap?.git ? (initialSnap.gitHash ?? "sha1") : undefined,
      );
      capture.touchedBaselines.set(candidate, baseline);
    }
  }
}

export function beginPromptFileChanges(identity: PromptRunIdentity, cwd: string): PromptFileCapture {
  const startedAt = Date.now();
  const record: PromptFileChanges = { sessionId: identity.sessionId, runId: identity.runId, cwd, startedAt, status: "running", partial: false, files: [] };
  getActive().set(identity.sessionId, record);
  const capture: PromptFileCapture = {
    identity,
    cwd,
    startedAt,
    touchedPaths: new Set(),
    touchedBaselines: new Map(),
    initial: Promise.resolve({ root: path.resolve(cwd), git: false, versions: new Map(), partial: false }),
  };
  getCaptures().set(identity.sessionId, capture);
  capture.initial = Promise.all([snapshot(cwd), persist(record).catch(() => {})]).then(([value]) => {
    capture.initialSettled = value;
    return value;
  });
  return capture;
}

export async function finishPromptFileChanges(capture: PromptFileCapture, status: "complete" | "aborted" | "error"): Promise<PromptFileChanges> {
  const { identity, cwd, startedAt } = capture;
  let result: PromptFileChanges;
  try {
    const before = await capture.initial;
    const after = await snapshot(cwd, before, capture.touchedPaths);
    result = {
      sessionId: identity.sessionId,
      runId: identity.runId,
      cwd,
      startedAt,
      finishedAt: Date.now(),
      status,
      partial: before.partial || after.partial,
      files: diffSnapshots(before, after, capture),
    };
  } catch {
    result = { sessionId: identity.sessionId, runId: identity.runId, cwd, startedAt, finishedAt: Date.now(), status: "unavailable", partial: true, files: [] };
  } finally {
    if (getCaptures().get(identity.sessionId) === capture) {
      getCaptures().delete(identity.sessionId);
    }
  }
  if (getActive().get(identity.sessionId)?.runId === identity.runId) {
    getActive().set(identity.sessionId, result);
    try { await persist(result); getActive().delete(identity.sessionId); }
    catch { /* Keep the result available in memory. */ }
  }
  return result;
}
