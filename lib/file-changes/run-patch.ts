import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { formatPatch, structuredPatch } from "diff";

const execFileAsync = promisify(execFile);
export const MAX_RUN_TEXT_FILE_BYTES = 96 * 1024;
export const MAX_RUN_TEXT_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_RUN_PATCH_BYTES = 1024 * 1024;
export const MAX_RUN_PATCH_FILES = 80;

const utf8 = new TextDecoder("utf-8", { fatal: true });

export function decodeRunText(data: Buffer): string | undefined {
  if (data.length > MAX_RUN_TEXT_FILE_BYTES || data.includes(0)) return undefined;
  try { return utf8.decode(data).replace(/\r\n/g, "\n"); }
  catch { return undefined; }
}

export async function readRunText(root: string, version: string | undefined, captured: string | undefined) {
  if (!version || version === "missing") return "";
  if (captured !== undefined) return captured;
  const blob = /^git:([a-f0-9]{40}|[a-f0-9]{64})$/.exec(version)?.[1];
  if (!blob) return undefined;
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, "cat-file", "blob", blob], {
      encoding: "buffer", maxBuffer: MAX_RUN_TEXT_FILE_BYTES, timeout: 3000, windowsHide: true,
    });
    return decodeRunText(stdout);
  } catch { return undefined; }
}

export function buildRunFilePatch(root: string, file: string, before: string, after: string, kind: "added" | "modified" | "deleted") {
  if (before === after) return undefined;
  const name = path.relative(root, file).replace(/\\/g, "/").replace(/[\r\n\t]/g, "?");
  const oldName = kind === "added" ? "/dev/null" : "a/" + name;
  const newName = kind === "deleted" ? "/dev/null" : "b/" + name;
  const patch = structuredPatch(oldName, newName, before, after, undefined, undefined, {
    context: 3, timeout: 60, maxEditLength: 8_000,
  });
  if (!patch?.hunks.length) return undefined;
  let additions = 0;
  let deletions = 0;
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
  }
  return { patch: formatPatch(patch), additions, deletions };
}
