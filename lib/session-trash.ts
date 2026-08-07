import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";

/**
 * Reversible session deletion (task T-01).
 *
 * Deleting a session moves its whole subtree (the session plus every
 * descendant that points at it via parentSession) into a trash directory
 * OUTSIDE the sessions tree — `~/.pi/agent/trash/sessions/` — because
 * `SessionManager.listAll` scans every subdirectory under the sessions root,
 * so a `.trash` inside it would resurface the deleted files. A small
 * per-session manifest records original → trashed paths so restore is an
 * exact move-back and cascade re-parenting (which mutates children) never
 * has to be reversed.
 *
 * The move is atomic per file (rename on the same volume), and the manifest
 * is written before any file moves, so an interrupted delete can still be
 * restored or purged on the next run.
 */

export interface TrashEntry {
  /** Absolute path the file had while it was a live session. */
  original: string;
  /** Absolute path it currently sits at inside the trash root. */
  trashed: string;
}

export interface TrashManifest {
  /** Session id of the deleted root session. */
  id: string;
  /** Epoch ms of the move — purge uses this. */
  trashedAt: number;
  entries: TrashEntry[];
}

export const TRASH_UNDO_WINDOW_MS = 5_000;

/** `~/.pi/agent/trash/sessions` — deliberately outside the sessions root. */
export function getTrashRoot(): string {
  return join(getAgentDir(), "trash", "sessions");
}

function manifestPath(id: string): string {
  return join(getTrashRoot(), `${id}.manifest.json`);
}

export function readTrashManifest(id: string): TrashManifest | null {
  try {
    const raw = readFileSync(manifestPath(id), "utf8");
    const parsed = JSON.parse(raw) as TrashManifest;
    return Array.isArray(parsed?.entries) ? parsed : null;
  } catch {
    return null;
  }
}

function writeManifest(manifest: TrashManifest): void {
  mkdirSync(getTrashRoot(), { recursive: true });
  writeFileSync(manifestPath(manifest.id), JSON.stringify(manifest, null, 2), "utf8");
}

function removeManifest(id: string): void {
  try {
    unlinkSync(manifestPath(id));
  } catch {
    // already gone
  }
}

/**
 * Move the given files into the trash. The manifest is written first so a
 * crash between writes leaves a restorable (or purgable) record.
 */
export function trashSession(id: string, files: string[]): TrashManifest {
  const entries: TrashEntry[] = files.map((original) => ({
    original,
    trashed: join(getTrashRoot(), `${id}`, sanitizeSegment(original)),
  }));
  const manifest: TrashManifest = { id, trashedAt: Date.now(), entries };
  writeManifest(manifest);
  for (const entry of entries) {
    if (!existsSync(entry.original)) continue;
    mkdirSync(dirname(entry.trashed), { recursive: true });
    renameSync(entry.original, entry.trashed);
  }
  return manifest;
}

/** Move every trashed file back to its original path. Returns false if the
 *  undo window has already been purged. */
export function restoreSession(id: string): boolean {
  const manifest = readTrashManifest(id);
  if (!manifest) return false;
  for (const entry of manifest.entries) {
    if (!existsSync(entry.trashed)) continue;
    mkdirSync(dirname(entry.original), { recursive: true });
    renameSync(entry.trashed, entry.original);
  }
  removeManifest(id);
  return true;
}

/** Permanently delete every trashed file older than `olderThanMs`. Safe to
 *  call on startup and after each new delete to sweep stale manifests. */
export function purgeExpiredTrash(olderThanMs = TRASH_UNDO_WINDOW_MS): void {
  const root = getTrashRoot();
  if (!existsSync(root)) return;
  const now = Date.now();
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".manifest.json")) continue;
    const manifest = readTrashManifest(name.slice(0, -".manifest.json".length));
    if (!manifest || now - manifest.trashedAt < olderThanMs) continue;
    for (const entry of manifest.entries) {
      try {
        rmSync(entry.trashed, { recursive: true, force: true });
      } catch {
        // best-effort sweep
      }
    }
    removeManifest(manifest.id);
  }
}

/** Trash files live under `trash/sessions/<id>/` with a short deterministic
 *  segment derived from the original path — sanitizing the raw path could
 *  exceed the Windows 260-char path limit for deeply nested sessions. */
function sanitizeSegment(filePath: string): string {
  let hash = 0;
  const key = filePath.replace(/\\/g, "/");
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return `${(hash >>> 0).toString(36)}_${key.split("/").pop() ?? "session"}`;
}
