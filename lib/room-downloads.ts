import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { TeamError } from "./team-errors";

/** Room metadata grants access only to immutable copies within its artifact directory. */
export function roomArtifactDownload(root: string, storedPath: string, name: string): Response {
  const actual = realpathSync(storedPath);
  const inside = relative(realpathSync(root), actual);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new TeamError("TEAM_INVALID_CONTEXT", "成果文件超出群聊目录。");
  return roomFileDownload(actual, name);
}

export function roomFileDownload(path: string, name: string): Response {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new TeamError("TEAM_INVALID_INPUT", "文件不可读取或超过 50 MiB。");
  return new Response(new Uint8Array(readFileSync(path)), { headers: {
    "Content-Type": "application/octet-stream", "Content-Length": String(stat.size),
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name.replace(/[\r\n]/gu, ""))}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
