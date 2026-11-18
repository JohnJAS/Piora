import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import { readInWorker } from "@/lib/read-worker";

// Same skip lists as /api/files — only used for the non-git readdir fallback.
// Git-tracked repos rely on .gitignore instead (matches the TUI's fd behavior).
const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);

const IGNORED_SUFFIXES = [".pyc"];

const WALK_HARD_CAP = 50_000;
const WALK_DIRECTORY_CAP = 50_000;
const MAX_WALK_DEPTH = 8;
const MAX_QUERY_LENGTH = 500;
const CACHE_TTL_MS = 10_000;
const CACHE_STALE_MS = 60_000;
const CACHE_MAX_ENTRIES = 20;

interface FileListing {
  /** Full listing up to the hard cap (not the client cap) */
  files: string[];
  /** True when even the hard cap was exceeded */
  hardTruncated: boolean;
}

interface CacheEntry {
  files: string[];
  truncated: boolean;
  version: string;
  identity: string;
  expiresAt: number;
}

// Per-cwd cache on globalThis so it survives Next.js hot-reload; the @ menu
// re-requests on every open and searches on every keystroke, so listings must
// not be recomputed within a short window.
declare global {
  var __piFileIndexCache: Map<string, CacheEntry> | undefined;
  var __piFileIndexPending: Map<string, Promise<CacheEntry>> | undefined;
}

function getIndexCache(): Map<string, CacheEntry> {
  if (!globalThis.__piFileIndexCache) globalThis.__piFileIndexCache = new Map();
  return globalThis.__piFileIndexCache;
}

function refreshIndex(cwd: string, identity: string): Promise<CacheEntry> {
  const pending = globalThis.__piFileIndexPending ??= new Map();
  const key = cwd + "\0" + identity;
  const current = pending.get(key);
  if (current) return current;
  const refresh = readInWorker<Pick<CacheEntry, "files" | "truncated" | "version">>("fileList", { cwd, identity }).then(listing => {
    const entry = { ...listing, identity, expiresAt: Date.now() + CACHE_TTL_MS };
    const cache = getIndexCache();
    cache.delete(cwd);
    cache.set(cwd, entry);
    if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    return entry;
  }).finally(() => pending.delete(key));
  pending.set(key, refresh);
  return refresh;
}

async function listWithWalk(cwd: string): Promise<FileListing> {
  const files: string[] = [];
  let hardTruncated = false;
  // BFS so shallow files win when the cap truncates the listing.
  const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs: cwd, rel: "", depth: 0 }];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { abs, rel, depth } = queue[cursor];
    let dirents: fs.Dirent[];
    try {
      dirents = await fs.promises.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      if (IGNORED_NAMES.has(d.name) || IGNORED_SUFFIXES.some((s) => d.name.endsWith(s))) continue;
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (depth + 1 <= MAX_WALK_DEPTH && queue.length < WALK_DIRECTORY_CAP) {
          queue.push({ abs: path.join(abs, d.name), rel: childRel, depth: depth + 1 });
        } else hardTruncated = true;
      } else if (d.isFile()) {
        if (files.length >= WALK_HARD_CAP) {
          return { files, hardTruncated: true };
        }
        files.push(childRel);
      }
    }
  }
  return { files, hardTruncated };
}

// GET /api/file-index?cwd=/abs/path[&q=query]
// Without q: { files: string[] (relative to cwd, capped at MAX_FILES),
// truncated: boolean } — the client-side index for local filtering.
// With q: { matches: { path, isDir }[] } — ranked against the FULL listing so
// repos larger than MAX_FILES still find deep files (cap applied after
// matching, like the TUI passing the query to fd).
// Guarded by the same allow-list as /api/files.
export async function GET(req: NextRequest) {
  try {
    const cwd = req.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    const query = req.nextUrl.searchParams.get("q")?.slice(0, MAX_QUERY_LENGTH) ?? "";
    const exactName = req.nextUrl.searchParams.get("name");
    if (exactName !== null && (!exactName || exactName.length > MAX_QUERY_LENGTH || /[\\/\x00-\x1f]/.test(exactName))) {
      return NextResponse.json({ error: "name must be a file name" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (exactName) {
      // Generated documents may be gitignored, or the cwd itself may be under
      // an ignored directory. Filename recovery searches the actual workspace.
      const listing = await listWithWalk(cwd);
      const compare = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
      const matches = listing.files.filter(file => {
        if (compare(path.posix.basename(file)) !== compare(exactName)) return false;
        const target = path.resolve(cwd, file);
        try { return isExistingFilePathAllowed(target, new Set([cwd])) && fs.statSync(target).isFile(); }
        catch { return false; }
      });
      return NextResponse.json({ matches: matches.slice(0, 100).map(file => ({ path: file, isDir: false })),
        truncated: listing.hardTruncated || matches.length > 100 });
    }

    const identity = [stat.dev, stat.ino, stat.birthtimeMs, stat.mtimeMs, stat.ctimeMs].join(":");
    const existing = getIndexCache().get(cwd);
    const now = Date.now();
    const usable = existing?.identity === identity && existing.expiresAt + CACHE_STALE_MS > now;
    const cached = usable ? existing : await refreshIndex(cwd, identity);
    if (usable && cached.expiresAt <= now) void refreshIndex(cwd, identity).catch(() => {});

    if (query) {
      const search = (version: string) => readInWorker<{ matches: FileIndexEntry[] } | { missing: true }>("fileSearch", { cwd, identity, version, query }, req.signal);
      let result = await search(cached.version);
      if ("missing" in result) result = await search((await refreshIndex(cwd, identity)).version);
      if ("missing" in result) return NextResponse.json({ error: "Workspace index changed; retry the search" }, { status: 503 });
      return NextResponse.json(result);
    }

    return NextResponse.json({ files: cached.files, truncated: cached.truncated });
  } catch (error) {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
