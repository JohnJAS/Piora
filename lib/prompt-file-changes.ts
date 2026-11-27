import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getRuntimeAgentDataDirectory } from "./runtime-home";
import { parseGitPorcelainV1 } from "./git-status";
import type { PromptRunIdentity } from "./prompt-run-registry";
import { buildRunFilePatch, decodeRunText, MAX_RUN_PATCH_BYTES, MAX_RUN_PATCH_FILES, MAX_RUN_TEXT_SNAPSHOT_BYTES, readRunText } from "./file-changes/run-patch";

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
  additions?: number;
  deletions?: number;
  patchRevision?: string;
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

type RecordedPromptFileChange = PromptFileChange & { patch?: string };
type RecordedPromptFileChanges = Omit<PromptFileChanges, "files"> & { files: RecordedPromptFileChange[] };

interface Snapshot {
  root: string;
  git: boolean;
  gitHash?: "sha1" | "sha256";
  versions: Map<string, string>;
  texts: Map<string, string>;
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
  touchedPending: Map<string, Promise<void>>;
  touchedBaselines: Map<string, string>;
  touchedTexts: Map<string, string>;
  touchedBudget: FingerprintBudget;
  liveCache?: { at: number; record: RecordedPromptFileChanges };
  liveInflight?: Promise<RecordedPromptFileChanges>;
}

declare global {
  var __pioraActivePromptFileChanges: Map<string, RecordedPromptFileChanges> | undefined;
  var __pioraActivePromptFileCaptures: Map<string, PromptFileCapture> | undefined;
}

function getActive(): Map<string, RecordedPromptFileChanges> {
  return globalThis.__pioraActivePromptFileChanges ??= new Map();
}

function getCaptures(): Map<string, PromptFileCapture> {
  return globalThis.__pioraActivePromptFileCaptures ??= new Map();
}

function storagePath(sessionId: string): string {
  const key = createHash("sha256").update(sessionId).digest("hex");
  return path.join(getRuntimeAgentDataDirectory(), "piora", "prompt-file-changes", `${key}.json`);
}

async function persist(record: RecordedPromptFileChanges): Promise<void> {
  const target = storagePath(record.sessionId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(record), "utf8");
  try { await fs.rename(temporary, target); }
  catch (error) { await fs.rm(temporary, { force: true }); throw error; }
}

async function diffSnapshots(before: Snapshot, after: Snapshot, capture: PromptFileCapture): Promise<RecordedPromptFileChange[]> {
  const files: RecordedPromptFileChange[] = [];
  let patchBytes = 0;
  for (const file of new Set([...before.versions.keys(), ...after.versions.keys(), ...capture.touchedPaths])) {
    const oldVersion = before.versions.get(file) ?? capture.touchedBaselines.get(file);
    const newVersion = after.versions.get(file);
    if (oldVersion === newVersion) continue;
    if ((oldVersion === undefined || oldVersion === "missing") && (newVersion === undefined || newVersion === "missing")) continue;
    const change: RecordedPromptFileChange = {
      path: file,
      kind: newVersion === undefined || newVersion === "missing"
        ? "deleted"
        : oldVersion === undefined || oldVersion === "missing"
          ? "added"
          : "modified",
    };
    if (files.length < MAX_RUN_PATCH_FILES && patchBytes < MAX_RUN_PATCH_BYTES) {
      const [original, edited] = await Promise.all([
        readRunText(before.root, oldVersion, before.texts.get(file) ?? capture.touchedTexts.get(file)),
        readRunText(after.root, newVersion, after.texts.get(file)),
      ]);
      const detail = original !== undefined && edited !== undefined
        ? buildRunFilePatch(after.root, file, original, edited, change.kind)
        : undefined;
      if (detail) {
        const size = Buffer.byteLength(detail.patch);
        if (patchBytes + size <= MAX_RUN_PATCH_BYTES) {
          patchBytes += size;
          Object.assign(change, detail, { patchRevision: createHash("sha256").update(detail.patch).digest("hex").slice(0, 16) });
        }
      }
    }
    files.push(change);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readPromptFileChanges(sessionId: string): Promise<RecordedPromptFileChanges | null> {
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
          const files = await diffSnapshots(before, after, capture);
          const record: RecordedPromptFileChanges = {
            ...running,
            status: "running",
            partial: before.partial || after.partial || capture.touchedBudget.partial,
            files,
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
    const parsed = JSON.parse(await fs.readFile(storagePath(sessionId), "utf8")) as RecordedPromptFileChanges;
    if (parsed.sessionId !== sessionId) return null;
    // An in-progress record left on disk after a process restart has no live
    // capture to finish it. Make that gap explicit instead of showing a spinner.
    return parsed.status === "running" ? { ...parsed, status: "unavailable", partial: true } : parsed;
  } catch { return null; }
}

function canonicalPath(target: string): string {
  const resolved = path.resolve(target);
  let probe = resolved;
  const trailing: string[] = [];
  while (true) {
    try {
      const real = realpathSync.native(probe);
      return trailing.length > 0 ? path.join(real, ...trailing.reverse()) : real;
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return resolved;
      trailing.push(path.basename(probe));
      probe = parent;
    }
  }
}

function safeAbsolute(root: string, relative: string): string | null {
  const absolute = path.resolve(root, relative);
  const fromRoot = path.relative(root, absolute);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) return null;
  return absolute;
}

interface FingerprintBudget {
  remaining: number;
  textRemaining: number;
  partial: boolean;
}

async function fingerprint(root: string, file: string, budget: FingerprintBudget, texts: Map<string, string>, gitHash?: "sha1" | "sha256"): Promise<string> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile()) { budget.partial = true; return "missing"; }
    if (stat.size > MAX_SINGLE_FILE_BYTES || stat.size > budget.remaining) {
      budget.partial = true;
      return `metadata:${stat.size}:${stat.mtimeMs}`;
    }
    const realFile = safeAbsolute(root, await fs.realpath(file));
    if (!realFile) { budget.partial = true; return "missing"; }
    budget.remaining -= stat.size;
    const data = await fs.readFile(realFile);
    if (data.length <= budget.textRemaining) {
      const text = decodeRunText(data);
      if (text !== undefined) {
        budget.textRemaining -= data.length;
        texts.set(file, text);
      }
    }
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
    return canonicalPath(stdout.trim());
  } catch { return null; }
}

async function gitPaths(root: string): Promise<{ paths: string[]; partial: boolean }> {
  const { stdout } = await execFileAsync("git", ["-C", root, "-c", "status.relativePaths=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"], { timeout: 15000, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" });
  const entries = parseGitPorcelainV1(stdout);
  // A staged-only entry already has the correct baseline in the index.
  const paths = [...new Set(entries.filter((entry) => entry.worktreeStatus !== " ")
    .flatMap((entry) => entry.worktreeStatus === "R" && entry.originalPath ? [entry.path, entry.originalPath] : [entry.path]))];
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
  const texts = new Map<string, string>();
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
  const budget = { remaining: MAX_HASH_BYTES, textRemaining: MAX_RUN_TEXT_SNAPSHOT_BYTES, partial: listing.partial || tracked.partial || candidates.size > MAX_FILES };
  let hashed = 0;
  for (const absolute of candidates) {
    // Keep Git's normalized blob for clean tracked files, including CRLF
    // checkouts. Explicitly touched ignored files are still fingerprinted.
    if (versions.has(absolute) && !dirtyPaths.has(absolute)) continue;
    if (hashed >= MAX_FILES) {
      budget.partial = true;
      break;
    }
    hashed += 1;
    versions.set(absolute, await fingerprint(root, absolute, budget, texts, gitHash));
  }
  return { root, git: true, gitHash, versions, texts, dirtyPaths, partial: budget.partial };
}

async function plainSnapshot(root: string, extraPaths: Iterable<string> = []): Promise<Snapshot> {
  const versions = new Map<string, string>();
  const texts = new Map<string, string>();
  const budget = { remaining: MAX_HASH_BYTES, textRemaining: MAX_RUN_TEXT_SNAPSHOT_BYTES, partial: false };
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
        versions.set(absolute, await fingerprint(root, absolute, budget, texts));
      }
    }
    if (versions.size >= MAX_FILES) break;
  }
  for (const raw of extraPaths) {
    const absolute = safeAbsolute(root, raw);
    if (absolute && !versions.has(absolute)) {
      versions.set(absolute, await fingerprint(root, absolute, budget, texts));
    }
  }
  return { root, git: false, versions, texts, partial: budget.partial };
}

async function snapshot(cwd: string, initial?: Snapshot, touchedPaths?: ReadonlySet<string>): Promise<Snapshot> {
  const discoveredGitRoot = initial ? null : await gitRoot(cwd);
  const root = initial?.root ?? discoveredGitRoot ?? canonicalPath(cwd);
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
  const baseCwd = canonicalPath(cwd || capture.cwd);
  const candidate = canonicalPath(path.resolve(baseCwd, trimmed));
  const initialSnap = capture.initialSettled ?? await capture.initial.catch(() => undefined);
  const allowedRoot = initialSnap?.root ?? canonicalPath(capture.cwd);
  const relativeFromRoot = path.relative(allowedRoot, candidate);
  if (!relativeFromRoot || relativeFromRoot === ".." || relativeFromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFromRoot)) {
    return;
  }
  if (getCaptures().get(sessionId) !== capture || capture.touchedPaths.has(candidate)) return;
  let pending = capture.touchedPending.get(candidate);
  if (!pending) {
    pending = (async () => {
      const baseline = initialSnap?.versions.get(candidate) ?? await fingerprint(
        allowedRoot, candidate, capture.touchedBudget, capture.touchedTexts, initialSnap?.gitHash,
      );
      capture.touchedBaselines.set(candidate, baseline);
      capture.touchedPaths.add(candidate);
      capture.liveCache = undefined;
    })().finally(() => capture.touchedPending.delete(candidate));
    capture.touchedPending.set(candidate, pending);
  }
  await pending;
}

export function beginPromptFileChanges(identity: PromptRunIdentity, cwd: string): PromptFileCapture {
  const startedAt = Date.now();
  const record: RecordedPromptFileChanges = { sessionId: identity.sessionId, runId: identity.runId, cwd, startedAt, status: "running", partial: false, files: [] };
  getActive().set(identity.sessionId, record);
  const capture: PromptFileCapture = {
    identity,
    cwd,
    startedAt,
    touchedPaths: new Set(),
    touchedPending: new Map(),
    touchedBaselines: new Map(),
    touchedTexts: new Map(),
    touchedBudget: { remaining: MAX_HASH_BYTES, textRemaining: MAX_RUN_TEXT_SNAPSHOT_BYTES, partial: false },
    initial: Promise.resolve({ root: path.resolve(cwd), git: false, versions: new Map(), texts: new Map(), partial: false }),
  };
  getCaptures().set(identity.sessionId, capture);
  capture.initial = Promise.all([snapshot(cwd), persist(record).catch(() => {})]).then(([value]) => {
    capture.initialSettled = value;
    return value;
  });
  return capture;
}

export async function finishPromptFileChanges(capture: PromptFileCapture, status: "complete" | "aborted" | "error"): Promise<RecordedPromptFileChanges> {
  const { identity, cwd, startedAt } = capture;
  let result: RecordedPromptFileChanges;
  try {
    const before = await capture.initial;
    const after = await snapshot(cwd, before, capture.touchedPaths);
    const files = await diffSnapshots(before, after, capture);
    result = {
      sessionId: identity.sessionId,
      runId: identity.runId,
      cwd,
      startedAt,
      finishedAt: Date.now(),
      status,
      partial: before.partial || after.partial || capture.touchedBudget.partial,
      files,
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
    try {
      await persist(result);
      if (getActive().get(identity.sessionId) === result) getActive().delete(identity.sessionId);
    }
    catch { /* Keep the result available in memory. */ }
  }
  return result;
}
