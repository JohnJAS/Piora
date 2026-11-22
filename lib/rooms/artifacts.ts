import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { RoomArtifact, RoomArtifactKind } from "../room-types";
import { cleanText, emitRoomEvent, getRoom, requireMember, ROOM_ID_PATTERN, roomPaths } from "./storage";
import { getRoomTask } from "./tasks";

function artifactMetadataPath(roomId: string, artifactId: string): string {
  if (!ROOM_ID_PATTERN.test(artifactId)) throw new Error("Invalid room artifact id.");
  return join(roomPaths(roomId).artifacts, `${artifactId}.json`);
}

export function listRoomArtifacts(roomId: string): RoomArtifact[] {
  const paths = roomPaths(roomId);
  getRoom(roomId);
  if (!existsSync(paths.artifacts)) return [];
  return readdirSync(paths.artifacts, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile() || !ROOM_ID_PATTERN.test(entry.name.replace(/\.json$/, "")) || !entry.name.endsWith(".json")) return [];
    try { return [JSON.parse(readFileSync(join(paths.artifacts, entry.name), "utf8")) as RoomArtifact]; } catch { return []; }
  }).sort((left, right) => left.createdAt - right.createdAt);
}

export function publishRoomArtifact(roomId: string, sessionId: string, input: {
  taskId?: string;
  kind: RoomArtifactKind;
  name: string;
  summary: string;
  sourcePath?: string;
  content?: string;
}): RoomArtifact {
  const room = getRoom(roomId);
  const member = requireMember(room, sessionId);
  if (input.taskId) {
    const task = getRoomTask(roomId, input.taskId);
    if (task.assignedTo !== sessionId && task.createdBy !== sessionId) throw new Error("This session is not associated with the artifact task.");
  }
  const id = randomUUID();
  const paths = roomPaths(roomId);
  mkdirSync(paths.artifacts, { recursive: true });
  let storedPath: string | undefined;
  let sourcePath: string | undefined;
  if (input.sourcePath) {
    if (!member.cwd) throw new Error("The room member has no registered workspace.");
    sourcePath = resolve(member.cwd, input.sourcePath);
    const inside = relative(resolve(member.cwd), sourcePath);
    if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("Artifact source must stay inside this session's workspace.");
    const realWorkspace = realpathSync(member.cwd);
    const realSource = realpathSync(sourcePath);
    const realInside = relative(realWorkspace, realSource);
    if (realInside.startsWith("..") || isAbsolute(realInside)) throw new Error("Artifact source symbolic link escapes this session's workspace.");
    sourcePath = realSource;
    const stat = statSync(sourcePath);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error("Artifact source must be a file no larger than 5 MB.");
    const safeName = basename(sourcePath).replace(/[^a-zA-Z0-9._-]/g, "_");
    storedPath = join(paths.artifacts, `${id}-${safeName}`);
    copyFileSync(sourcePath, storedPath);
  } else if (input.content !== undefined) {
    if (Buffer.byteLength(input.content, "utf8") > 5 * 1024 * 1024) throw new Error("Artifact content must be no larger than 5 MB.");
    const safeName = basename(input.name).replace(/[^a-zA-Z0-9._-]/g, "_") || "artifact.txt";
    storedPath = join(paths.artifacts, `${id}-${safeName}`);
    writeFileSync(storedPath, input.content, "utf8");
  }
  const artifact: RoomArtifact = {
    schemaVersion: 1,
    id,
    roomId,
    sessionId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    kind: input.kind,
    name: cleanText(input.name, 240),
    summary: cleanText(input.summary, 4_000),
    ...(sourcePath ? { sourcePath } : {}),
    ...(storedPath ? { storedPath } : {}),
    worktree: {
      cwd: member.cwd,
      projectRoot: member.projectRoot,
      branch: member.worktreeBranch,
    },
    createdAt: Date.now(),
  };
  writeFileSync(artifactMetadataPath(roomId, id), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  emitRoomEvent({ type: "artifact", roomId, artifact });
  return artifact;
}
