import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildEntriesFromFiles, filterFileEntries } from "./file-ranking.mjs";

const CLIENT_LIMIT = 5000;
const GIT_LIMIT = 200_000;
const WALK_LIMIT = 50_000;
const WALK_DIRECTORY_LIMIT = 50_000;
const WALK_DEPTH = 8;
const MAX_WORKSPACE_BYTES = 40 * 1024 * 1024;
const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const MAX_CACHE_COUNT = 12;
const ignored = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache", "target", "vendor", ".DS_Store"]);
const snapshots = new Map();
let cachedBytes = 0;

async function gitList(cwd, check) {
  const child = spawn("git", ["-C", cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    windowsHide: true, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, LC_ALL: "C" },
  });
  const finished = new Promise(resolve => {
    child.once("error", () => resolve(false));
    child.once("close", code => resolve(code === 0));
  });
  const timeout = setTimeout(() => child.kill(), 10_000);
  const files = [];
  const digest = createHash("sha256");
  let bytes = 0, pending = "";
  child.stdout.setEncoding("utf8");
  try {
    for await (const chunk of child.stdout) {
      check();
      const text = pending + chunk;
      let start = 0;
      for (let end = text.indexOf("\0"); end !== -1; end = text.indexOf("\0", start)) {
        const path = text.slice(start, end);
        start = end + 1;
        if (!path) continue;
        bytes += 64 + path.length * 4;
        if (files.length === GIT_LIMIT || bytes > MAX_WORKSPACE_BYTES) {
          child.kill();
          return { files, bytes, truncated: true, version: digest.digest("hex") };
        }
        digest.update(path).update("\0");
        files.push(path);
      }
      pending = text.slice(start);
      if (pending.length > MAX_WORKSPACE_BYTES) return null;
    }
    if (!await finished) return null;
    return { files, bytes, truncated: false, version: digest.digest("hex") };
  } finally {
    clearTimeout(timeout);
    child.kill();
  }
}

async function walk(cwd, check) {
  const files = [];
  let truncated = false, bytes = 0;
  const digest = createHash("sha256");
  const queue = [{ relative: "", depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    check();
    const { relative, depth } = queue[index];
    const entries = await readdir(join(cwd, relative), { withFileTypes: true }).catch(() => []);
    for (const item of entries) {
      if (ignored.has(item.name) || item.name.endsWith(".pyc")) continue;
      const path = relative ? relative + "/" + item.name : item.name;
      if (item.isDirectory()) {
        if (depth < WALK_DEPTH && queue.length < WALK_DIRECTORY_LIMIT) queue.push({ relative: path, depth: depth + 1 });
        else truncated = true;
      } else if (item.isFile()) {
        bytes += 64 + path.length * 4;
        if (files.length === WALK_LIMIT || bytes > MAX_WORKSPACE_BYTES) return { files, bytes, truncated: true, version: digest.digest("hex") };
        digest.update(path).update("\0");
        files.push(path);
      }
    }
  }
  return { files, bytes, truncated, version: digest.digest("hex") };
}

function remember(workspace, value) {
  const prior = snapshots.get(workspace);
  if (prior) cachedBytes -= prior.cost;
  snapshots.delete(workspace);
  snapshots.set(workspace, value);
  cachedBytes += value.cost;
  while ((cachedBytes > MAX_CACHE_BYTES || snapshots.size > MAX_CACHE_COUNT) && snapshots.size > 1) {
    const oldest = snapshots.keys().next().value;
    cachedBytes -= snapshots.get(oldest).cost;
    snapshots.delete(oldest);
  }
}

export async function fileIndex(operation, data, check) {
  const { cwd } = data;
  const key = cwd + "\0" + (data.identity ?? "");
  if (operation === "fileList") {
    const value = await gitList(cwd, check).catch(error => {
      check();
      if (error.code !== "ABORT_ERR") return null;
      throw error;
    }) ?? await walk(cwd, check);
    check();
    const prior = snapshots.get(key);
    const snapshot = prior?.version === value.version && prior.truncated === value.truncated ? prior
      : { ...value, cost: value.bytes + 1 };
    remember(key, snapshot);
    return { files: snapshot.files.slice(0, CLIENT_LIMIT),
      truncated: snapshot.truncated || snapshot.files.length > CLIENT_LIMIT, version: snapshot.version };
  }
  if (operation !== "fileSearch") throw new Error("Unknown workspace read");
  const value = snapshots.get(key);
  if (!value || value.version !== data.version) return { missing: true };
  if (!value.entries) {
    value.entries = buildEntriesFromFiles(value.files);
    cachedBytes -= value.cost;
    value.cost += value.entries.reduce((total, entry) => total + 128 + entry.path.length * 4, 0);
    cachedBytes += value.cost;
  }
  remember(key, value);
  return { matches: filterFileEntries(value.entries, data.query, 20, check) };
}
