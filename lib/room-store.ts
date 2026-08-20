import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  CollaborationRoom,
  PrivateRoomNote,
  RoomMember,
  RoomMessage,
  RoomMessageAuthorKind,
  RoomMemberRole,
  RoomEvent,
  RoomTask,
  RoomArtifact,
  RoomArtifactKind,
  RoomAuditEntry,
} from "./room-types";

const ROOM_SCHEMA_VERSION = 2 as const;
const ROOM_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const MAX_MESSAGE_LENGTH = 20_000;
const MAX_ROOM_NAME_LENGTH = 120;

type RoomListener = (message: RoomMessage) => void;
type RoomEventListener = (event: RoomEvent) => void;

declare global {
  var __pioraRoomListeners: Map<string, Set<RoomListener>> | undefined;
  var __pioraRoomEventListeners: Map<string, Set<RoomEventListener>> | undefined;
}

function roomEventListeners(): Map<string, Set<RoomEventListener>> {
  return globalThis.__pioraRoomEventListeners ??= new Map();
}

function emitRoomEvent(event: RoomEvent): void {
  for (const listener of roomEventListeners().get(event.roomId) ?? []) listener(event);
}

function roomListeners(): Map<string, Set<RoomListener>> {
  return globalThis.__pioraRoomListeners ??= new Map();
}

export function getRoomsRoot(): string {
  const root = process.env.PIORA_ROOMS_ROOT
    ? resolve(process.env.PIORA_ROOMS_ROOT)
    : resolve(getAgentDir(), "piora", "rooms");
  mkdirSync(root, { recursive: true });
  return root;
}

function assertRoomId(roomId: string): string {
  if (!ROOM_ID_PATTERN.test(roomId)) throw new Error("Invalid collaboration room id.");
  return roomId;
}

function roomPaths(roomId: string) {
  const root = join(getRoomsRoot(), assertRoomId(roomId));
  return {
    root,
    metadata: join(root, "room.json"),
    shared: join(root, "shared"),
    messages: join(root, "shared", "messages.jsonl"),
    artifacts: join(root, "shared", "artifacts"),
    privateRoot: join(root, "private"),
    tasks: join(root, "shared", "tasks"),
    audit: join(root, "shared", "audit.jsonl"),
    workspace: join(root, "workspace"),
  };
}

function safeMemberDirectory(memberId: string): string {
  const encoded = Buffer.from(memberId, "utf8").toString("base64url");
  if (!encoded) throw new Error("A member id is required.");
  return encoded;
}

function cleanText(value: string, maxLength: number): string {
  const cleaned = value.trim().slice(0, maxLength);
  if (!cleaned) throw new Error("A non-empty value is required.");
  return cleaned;
}

function writeRoom(room: CollaborationRoom): void {
  const paths = roomPaths(room.id);
  mkdirSync(paths.root, { recursive: true });
  const temporary = `${paths.metadata}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(room, null, 2)}\n`, "utf8");
  renameSync(temporary, paths.metadata);
}

function appendRoomAudit(roomId: string, actorSessionId: string, action: RoomAuditEntry["action"], summary: string): RoomAuditEntry {
  const paths = roomPaths(roomId);
  mkdirSync(paths.shared, { recursive: true });
  const audit: RoomAuditEntry = { id: randomUUID(), roomId, actorSessionId, action, summary: cleanText(summary, 1_000), createdAt: Date.now() };
  appendFileSync(paths.audit, `${JSON.stringify(audit)}\n`, "utf8");
  emitRoomEvent({ type: "audit", roomId, audit });
  return audit;
}

export function listRoomAudit(roomId: string, limit = 100): RoomAuditEntry[] {
  const paths = roomPaths(roomId);
  getRoom(roomId);
  if (!existsSync(paths.audit)) return [];
  return readFileSync(paths.audit, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as RoomAuditEntry]; } catch { return []; }
  }).slice(-Math.max(1, Math.min(500, limit)));
}

function parseRoom(value: unknown): CollaborationRoom | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if ((source.schemaVersion !== 1 && source.schemaVersion !== ROOM_SCHEMA_VERSION) || typeof source.id !== "string" || !ROOM_ID_PATTERN.test(source.id)) return null;
  const room = source as unknown as CollaborationRoom;
  if (typeof room.name !== "string" || typeof room.createdAt !== "number" || typeof room.updatedAt !== "number") return null;
  if (typeof room.nextSeq !== "number" || !Array.isArray(room.members) || !room.paths) return null;
  room.schemaVersion = ROOM_SCHEMA_VERSION;
  room.description = typeof room.description === "string" ? room.description : "";
  room.members = room.members.flatMap((member) => {
    if (!member || typeof member.sessionId !== "string" || !member.sessionId) return [];
    return [{
      ...member,
      memberId: typeof member.memberId === "string" && member.memberId ? member.memberId : member.sessionId,
      role: member.role ?? "participant",
      instructions: typeof member.instructions === "string" ? member.instructions : "",
    }];
  });
  const paths = roomPaths(room.id);
  room.workspace = room.workspace && typeof room.workspace.path === "string"
    ? {
        mode: room.workspace.mode === "custom" ? "custom" : "managed",
        path: resolve(room.workspace.path),
        label: typeof room.workspace.label === "string" && room.workspace.label.trim() ? room.workspace.label : "共享工作区",
        instructions: typeof room.workspace.instructions === "string" ? room.workspace.instructions : "",
      }
    : { mode: "managed", path: paths.workspace, label: "共享工作区", instructions: "" };
  mkdirSync(room.workspace.path, { recursive: true });
  return room as CollaborationRoom;
}

export function getRoom(roomId: string): CollaborationRoom {
  const path = roomPaths(roomId).metadata;
  if (!existsSync(path)) throw new Error("Collaboration room not found.");
  const source = JSON.parse(readFileSync(path, "utf8")) as { schemaVersion?: unknown };
  const sourceVersion = source.schemaVersion;
  const room = parseRoom(source);
  if (!room) throw new Error("Collaboration room metadata is invalid.");
  room.coordination ??= { mode: "manual", maxConcurrency: 2, leaseDurationMs: 5 * 60_000 };
  if (sourceVersion !== ROOM_SCHEMA_VERSION) writeRoom(room);
  return room;
}

export function listRooms(sessionId?: string): CollaborationRoom[] {
  const root = getRoomsRoot();
  const rooms: CollaborationRoom[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ROOM_ID_PATTERN.test(entry.name)) continue;
    try {
      const room = getRoom(entry.name);
      if (!sessionId || room.members.some((member) => member.sessionId === sessionId)) rooms.push(room);
    } catch {
      // A partial/corrupt directory is ignored instead of breaking all rooms.
    }
  }
  return rooms.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function createRoom(input: {
  name: string;
  description?: string;
  projectRoot?: string;
  creator: Omit<RoomMember, "memberId" | "joinedAt"> & { memberId?: string };
}): CollaborationRoom {
  const id = randomUUID();
  const now = Date.now();
  const paths = roomPaths(id);
  mkdirSync(paths.artifacts, { recursive: true });
  mkdirSync(paths.privateRoot, { recursive: true });
  mkdirSync(paths.workspace, { recursive: true });
  const creator: RoomMember = {
    ...input.creator,
    memberId: input.creator.memberId ?? randomUUID(),
    role: input.creator.role ?? "coordinator",
    joinedAt: now,
  };
  const room: CollaborationRoom = {
    schemaVersion: ROOM_SCHEMA_VERSION,
    id,
    name: cleanText(input.name, MAX_ROOM_NAME_LENGTH),
    description: input.description?.trim().slice(0, 2_000) ?? "",
    ...(input.projectRoot ? { projectRoot: resolve(input.projectRoot) } : {}),
    createdAt: now,
    updatedAt: now,
    nextSeq: 1,
    members: [creator],
    coordination: { mode: "manual", maxConcurrency: 2, leaseDurationMs: 5 * 60_000 },
    workspace: { mode: "managed", path: paths.workspace, label: "共享工作区", instructions: "" },
    paths: { root: paths.root, shared: paths.shared, privateRoot: paths.privateRoot },
  };
  mkdirSync(join(paths.privateRoot, safeMemberDirectory(creator.memberId)), { recursive: true });
  writeRoom(room);
  appendRoomAudit(id, creator.sessionId, "room.created", `创建协作空间「${room.name}」。`);
  emitRoomEvent({ type: "room", roomId: room.id, room });
  appendRoomMessage(id, {
    authorKind: "system",
    authorId: "piora",
    authorName: "Piora",
    content: `${input.creator.name || input.creator.sessionId} 创建了协作空间。`,
  });
  return getRoom(id);
}

export function addRoomMember(roomId: string, input: {
  memberId?: string;
  sessionId: string;
  name?: string;
  instructions?: string;
  cwd?: string;
  projectRoot?: string;
  worktreeBranch?: string;
  role?: RoomMemberRole;
  requestedBy?: string;
}): CollaborationRoom {
  const room = getRoom(roomId);
  if (room.projectRoot && input.projectRoot && resolve(room.projectRoot) !== resolve(input.projectRoot)) {
    throw new Error("The session belongs to a different project and cannot join this room.");
  }
  const existing = room.members.find((member) => member.sessionId === input.sessionId);
  if (existing) {
    existing.name = input.name ?? existing.name;
    existing.cwd = input.cwd ?? existing.cwd;
    existing.projectRoot = input.projectRoot ?? existing.projectRoot;
    existing.worktreeBranch = input.worktreeBranch ?? existing.worktreeBranch;
    existing.role = input.role ?? existing.role;
    existing.instructions = input.instructions ?? existing.instructions;
  } else {
    room.members.push({
      memberId: input.memberId ?? randomUUID(),
      sessionId: input.sessionId,
      name: input.name,
      instructions: input.instructions,
      cwd: input.cwd,
      projectRoot: input.projectRoot,
      worktreeBranch: input.worktreeBranch,
      role: input.role ?? "participant",
      joinedAt: Date.now(),
    });
  }
  room.updatedAt = Date.now();
  const saved = room.members.find((member) => member.sessionId === input.sessionId)!;
  if (saved.role === "coordinator") {
    for (const member of room.members) if (member.memberId !== saved.memberId && member.role === "coordinator") member.role = "participant";
    room.coordination.coordinatorSessionId = saved.sessionId;
  }
  mkdirSync(join(room.paths.privateRoot, safeMemberDirectory(saved.memberId)), { recursive: true });
  writeRoom(room);
  appendRoomAudit(roomId, input.requestedBy ?? input.sessionId, existing ? "member.updated" : "member.added", existing
    ? `更新 Agent「${saved.name || saved.sessionId}」的资料。`
    : `Agent「${saved.name || saved.sessionId}」加入协作空间。`);
  emitRoomEvent({ type: "room", roomId: room.id, room });
  if (!existing) {
    appendRoomMessage(roomId, {
      authorKind: "system",
      authorId: "piora",
      authorName: "Piora",
      content: `${input.name || input.sessionId} 加入了协作空间。`,
    });
  }
  return getRoom(roomId);
}

export function removeRoomMember(roomId: string, sessionId: string, requestedBy?: string): CollaborationRoom {
  const room = getRoom(roomId);
  if (requestedBy) {
    const requester = requireMember(room, requestedBy);
    if (requestedBy !== sessionId && requester.role !== "coordinator" && room.coordination.coordinatorSessionId !== requestedBy) {
      throw new Error("Only the room coordinator can remove another Agent.");
    }
  }
  const member = room.members.find((item) => item.sessionId === sessionId);
  if (!member) return room;
  if (room.members.length === 1) throw new Error("A collaboration room must keep at least one Agent.");
  const activeTask = listRoomTasks(roomId).find((task) => task.assignedTo === sessionId && (task.status === "leased" || task.status === "running"));
  if (activeTask) throw new Error("Finish or release the Agent's active task before removing it.");
  for (const task of listRoomTasks(roomId)) {
    if (task.assignedTo === sessionId && task.status === "pending") {
      task.assignedTo = undefined;
      task.updatedAt = Date.now();
      writeTask(task);
    }
  }
  room.members = room.members.filter((item) => item.sessionId !== sessionId);
  if (room.coordination.coordinatorSessionId === sessionId || member.role === "coordinator") {
    const replacement = room.members[0];
    replacement.role = "coordinator";
    room.coordination.coordinatorSessionId = replacement.sessionId;
  }
  room.updatedAt = Date.now();
  writeRoom(room);
  appendRoomAudit(roomId, requestedBy ?? sessionId, "member.removed", `将 Agent「${member.name || member.sessionId}」移出协作空间。`);
  emitRoomEvent({ type: "room", roomId: room.id, room });
  appendRoomMessage(roomId, {
    authorKind: "system",
    authorId: "piora",
    authorName: "Piora",
    content: `${member.name || member.sessionId} 已离开协作空间。`,
  });
  return getRoom(roomId);
}

export function deleteRoom(roomId: string, requestedBy: string): void {
  const room = getRoom(roomId);
  const member = requireMember(room, requestedBy);
  if (member.role !== "coordinator" && room.coordination.coordinatorSessionId !== requestedBy) {
    throw new Error("Only the room coordinator can delete this collaboration room.");
  }
  emitRoomEvent({ type: "room", roomId, room });
  const paths = roomPaths(roomId);
  rmSync(paths.root, { recursive: true, force: false });
  roomListeners().delete(roomId);
  roomEventListeners().delete(roomId);
}

function requireMember(room: CollaborationRoom, sessionId: string): RoomMember {
  const member = room.members.find((item) => item.sessionId === sessionId);
  if (!member) throw new Error("This session is not a member of the collaboration room.");
  return member;
}

function requireCoordinator(room: CollaborationRoom, sessionId: string): RoomMember {
  const member = requireMember(room, sessionId);
  if (member.role !== "coordinator" && room.coordination.coordinatorSessionId !== sessionId) {
    throw new Error("Only the room coordinator can change collaboration settings.");
  }
  return member;
}

export function getPrivateRoomDirectory(roomId: string, sessionId: string): string {
  const room = getRoom(roomId);
  const member = requireMember(room, sessionId);
  return join(room.paths.privateRoot, safeMemberDirectory(member.memberId));
}

export function updateRoomProfile(roomId: string, requestedBy: string, input: { name: string; description?: string }): CollaborationRoom {
  const room = getRoom(roomId);
  requireCoordinator(room, requestedBy);
  const previousName = room.name;
  room.name = cleanText(input.name, MAX_ROOM_NAME_LENGTH);
  room.description = input.description?.trim().slice(0, 2_000) ?? "";
  room.updatedAt = Date.now();
  writeRoom(room);
  appendRoomAudit(roomId, requestedBy, "room.updated", `更新协作空间资料：「${room.name}」。`);
  emitRoomEvent({ type: "room", roomId, room });
  if (previousName !== room.name) {
    appendRoomMessage(roomId, { authorKind: "system", authorId: "piora", authorName: "Piora", content: `协作空间已从「${previousName}」更名为「${room.name}」。` });
  }
  return getRoom(roomId);
}

function isInside(parent: string, target: string): boolean {
  const path = relative(resolve(parent), resolve(target));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function updateRoomWorkspace(roomId: string, requestedBy: string, input: {
  mode: "managed" | "custom";
  path?: string;
  label?: string;
  instructions?: string;
}): CollaborationRoom {
  const room = getRoom(roomId);
  requireCoordinator(room, requestedBy);
  const paths = roomPaths(roomId);
  const workspacePath = input.mode === "managed" ? paths.workspace : resolve(cleanText(input.path ?? "", 2_000));
  if (input.mode === "custom" && (!room.projectRoot || !isInside(room.projectRoot, workspacePath))) {
    throw new Error("The shared workspace must stay inside the room project.");
  }
  mkdirSync(workspacePath, { recursive: true });
  room.workspace = {
    mode: input.mode,
    path: workspacePath,
    label: input.label?.trim().slice(0, 120) || "共享工作区",
    instructions: input.instructions?.trim().slice(0, 4_000) ?? "",
  };
  room.updatedAt = Date.now();
  writeRoom(room);
  appendRoomAudit(roomId, requestedBy, "workspace.updated", `将共享工作区修改为 ${workspacePath}。`);
  emitRoomEvent({ type: "room", roomId, room });
  appendRoomMessage(roomId, { authorKind: "system", authorId: "piora", authorName: "Piora", content: `共享工作区已修改为 ${workspacePath}。` });
  return getRoom(roomId);
}

export function updateRoomMember(roomId: string, requestedBy: string, memberId: string, input: {
  sessionId?: string;
  name?: string;
  instructions?: string;
  role?: RoomMemberRole;
  cwd?: string;
  projectRoot?: string;
  worktreeBranch?: string;
}): CollaborationRoom {
  const room = getRoom(roomId);
  requireCoordinator(room, requestedBy);
  const member = room.members.find((candidate) => candidate.memberId === memberId);
  if (!member) throw new Error("Collaboration Agent was not found.");
  const previousSessionId = member.sessionId;
  const nextSessionId = input.sessionId ?? previousSessionId;
  if (room.coordination.coordinatorSessionId === previousSessionId && input.role && input.role !== "coordinator") {
    throw new Error("Transfer coordination to another Agent before changing the coordinator role.");
  }
  if (nextSessionId !== previousSessionId && room.members.some((candidate) => candidate.sessionId === nextSessionId)) {
    throw new Error("That Session is already bound to another Agent in this room.");
  }
  if (input.projectRoot && room.projectRoot && resolve(input.projectRoot) !== resolve(room.projectRoot)) {
    throw new Error("The Session belongs to a different project and cannot be bound to this Agent.");
  }
  if (nextSessionId !== previousSessionId) {
    const activeTask = listRoomTasks(roomId).find((task) => task.assignedTo === previousSessionId && (task.status === "leased" || task.status === "running"));
    if (activeTask) throw new Error("Finish or release the Agent's active task before changing its Session.");
    for (const task of listRoomTasks(roomId)) {
      if (task.assignedTo === previousSessionId && task.status === "pending") {
        task.assignedTo = nextSessionId;
        task.updatedAt = Date.now();
        writeTask(task);
      }
    }
    if (room.coordination.coordinatorSessionId === previousSessionId) room.coordination.coordinatorSessionId = nextSessionId;
  }
  member.sessionId = nextSessionId;
  member.name = input.name?.trim().slice(0, 120) || member.name || nextSessionId.slice(0, 8);
  member.instructions = input.instructions?.trim().slice(0, 4_000) ?? member.instructions ?? "";
  member.role = input.role ?? member.role;
  member.cwd = input.cwd ?? member.cwd;
  member.projectRoot = input.projectRoot ?? member.projectRoot;
  member.worktreeBranch = input.worktreeBranch;
  if (member.role === "coordinator") {
    for (const candidate of room.members) if (candidate.memberId !== member.memberId && candidate.role === "coordinator") candidate.role = "participant";
    room.coordination.coordinatorSessionId = member.sessionId;
  }
  room.updatedAt = Date.now();
  writeRoom(room);
  appendRoomAudit(roomId, requestedBy, "member.updated", `更新 Agent「${member.name || member.sessionId}」的身份与职责。`);
  emitRoomEvent({ type: "room", roomId, room });
  appendRoomMessage(roomId, {
    authorKind: "system", authorId: "piora", authorName: "Piora",
    content: nextSessionId === previousSessionId ? `${member.name} 的身份与职责已更新。` : `${member.name} 已换绑到 Session ${nextSessionId.slice(0, 8)}。`,
  });
  return getRoom(roomId);
}

export function listRoomMessages(roomId: string, options: { afterSeq?: number; limit?: number } = {}): RoomMessage[] {
  const path = roomPaths(roomId).messages;
  getRoom(roomId);
  if (!existsSync(path)) return [];
  const afterSeq = Math.max(0, options.afterSeq ?? 0);
  const limit = Math.max(1, Math.min(500, options.limit ?? 200));
  const messages = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line) as RoomMessage]; } catch { return []; }
    })
    .filter((message) => message.roomId === roomId && message.seq > afterSeq);
  return messages.slice(-limit);
}

export function appendRoomMessage(roomId: string, input: {
  authorKind: RoomMessageAuthorKind;
  authorId: string;
  authorName?: string;
  content: string;
  replyTo?: string;
  correlationId?: string;
  forwardDepth?: number;
  autoRound?: number;
  maxAutoRounds?: number;
}): RoomMessage {
  const room = getRoom(roomId);
  if (input.authorKind === "session") requireMember(room, input.authorId);
  const message: RoomMessage = {
    id: randomUUID(),
    roomId,
    seq: room.nextSeq,
    author: { kind: input.authorKind, id: input.authorId, ...(input.authorName ? { name: input.authorName } : {}) },
    content: cleanText(input.content, MAX_MESSAGE_LENGTH),
    createdAt: Date.now(),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.correlationId ? { correlationId: cleanText(input.correlationId, 240) } : {}),
    ...(input.forwardDepth !== undefined ? { forwardDepth: Math.max(0, Math.min(4, Math.floor(input.forwardDepth))) } : {}),
    ...(input.autoRound !== undefined ? { autoRound: Math.max(0, Math.min(8, Math.floor(input.autoRound))) } : {}),
    ...(input.maxAutoRounds !== undefined ? { maxAutoRounds: Math.max(0, Math.min(8, Math.floor(input.maxAutoRounds))) } : {}),
  };
  const paths = roomPaths(roomId);
  mkdirSync(paths.shared, { recursive: true });
  appendFileSync(paths.messages, `${JSON.stringify(message)}\n`, "utf8");
  room.nextSeq += 1;
  room.updatedAt = message.createdAt;
  writeRoom(room);
  for (const listener of roomListeners().get(roomId) ?? []) listener(message);
  emitRoomEvent({ type: "message", roomId, message });
  return message;
}

export function configureRoomCoordination(roomId: string, input: {
  mode: "manual" | "coordinator";
  coordinatorSessionId?: string;
  maxConcurrency?: number;
  leaseDurationMs?: number;
  requestedBy?: string;
}): CollaborationRoom {
  const room = getRoom(roomId);
  if (input.requestedBy) requireCoordinator(room, input.requestedBy);
  if (input.coordinatorSessionId) requireMember(room, input.coordinatorSessionId);
  room.coordination = {
    mode: input.mode,
    ...(input.coordinatorSessionId ? { coordinatorSessionId: input.coordinatorSessionId } : {}),
    maxConcurrency: Math.max(1, Math.min(16, Math.floor(input.maxConcurrency ?? room.coordination?.maxConcurrency ?? 2))),
    leaseDurationMs: Math.max(30_000, Math.min(60 * 60_000, Math.floor(input.leaseDurationMs ?? room.coordination?.leaseDurationMs ?? 5 * 60_000))),
  };
  if (input.coordinatorSessionId) {
    for (const member of room.members) {
      if (member.sessionId === input.coordinatorSessionId) member.role = "coordinator";
      else if (member.role === "coordinator") member.role = "participant";
    }
  }
  room.updatedAt = Date.now();
  writeRoom(room);
  appendRoomAudit(roomId, input.requestedBy ?? input.coordinatorSessionId ?? "piora", "coordination.updated", `编排模式已设为${room.coordination.mode === "coordinator" ? "协调者编排" : "手动协作"}，最大并发 ${room.coordination.maxConcurrency}。`);
  emitRoomEvent({ type: "room", roomId, room });
  return room;
}

function taskPath(roomId: string, taskId: string): string {
  if (!ROOM_ID_PATTERN.test(taskId)) throw new Error("Invalid room task id.");
  return join(roomPaths(roomId).tasks, `${taskId}.json`);
}

function writeTask(task: RoomTask): void {
  const path = taskPath(task.roomId, task.id);
  mkdirSync(roomPaths(task.roomId).tasks, { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(task, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
  emitRoomEvent({ type: "task", roomId: task.roomId, task });
}

export function getRoomTask(roomId: string, taskId: string): RoomTask {
  getRoom(roomId);
  const path = taskPath(roomId, taskId);
  if (!existsSync(path)) throw new Error("Room task not found.");
  return JSON.parse(readFileSync(path, "utf8")) as RoomTask;
}

function recycleExpiredTask(task: RoomTask, now = Date.now()): RoomTask {
  if ((task.status !== "leased" && task.status !== "running") || !task.lease || task.lease.expiresAt > now) return task;
  task.lease = undefined;
  task.assignedTo = undefined;
  task.updatedAt = now;
  if (task.attempt >= task.maxAttempts) {
    task.status = "failed";
    task.error = "Task lease expired after the maximum number of attempts.";
  } else {
    task.status = "pending";
    task.error = "Previous task lease expired and was released for retry.";
  }
  writeTask(task);
  return task;
}

export function listRoomTasks(roomId: string): RoomTask[] {
  const paths = roomPaths(roomId);
  getRoom(roomId);
  if (!existsSync(paths.tasks)) return [];
  const tasks = readdirSync(paths.tasks, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile() || !entry.name.endsWith(".json")) return [];
    try {
      return [recycleExpiredTask(JSON.parse(readFileSync(join(paths.tasks, entry.name), "utf8")) as RoomTask)];
    } catch {
      return [];
    }
  });
  return tasks.sort((left, right) => right.priority - left.priority || left.createdAt - right.createdAt);
}

export function createRoomTask(roomId: string, input: {
  title: string;
  description: string;
  createdBy: string;
  assignedTo?: string;
  dedupeKey?: string;
  priority?: number;
  dependsOn?: string[];
  maxAttempts?: number;
}): RoomTask {
  const room = getRoom(roomId);
  requireMember(room, input.createdBy);
  if (input.assignedTo) requireMember(room, input.assignedTo);
  const dedupeKey = input.dedupeKey?.trim().slice(0, 200);
  if (dedupeKey) {
    const existing = listRoomTasks(roomId).find((task) => task.dedupeKey === dedupeKey && task.status !== "cancelled" && task.status !== "failed");
    if (existing) return existing;
  }
  const now = Date.now();
  const task: RoomTask = {
    schemaVersion: 1,
    id: randomUUID(),
    roomId,
    title: cleanText(input.title, 240),
    description: cleanText(input.description, MAX_MESSAGE_LENGTH),
    status: "pending",
    priority: Math.max(-100, Math.min(100, Math.floor(input.priority ?? 0))),
    createdBy: input.createdBy,
    ...(input.assignedTo ? { assignedTo: input.assignedTo } : {}),
    ...(dedupeKey ? { dedupeKey } : {}),
    dependsOn: [...new Set(input.dependsOn ?? [])],
    attempt: 0,
    maxAttempts: Math.max(1, Math.min(10, Math.floor(input.maxAttempts ?? 3))),
    createdAt: now,
    updatedAt: now,
  };
  writeTask(task);
  return task;
}

function dependenciesComplete(task: RoomTask, tasks: RoomTask[]): boolean {
  return task.dependsOn.every((id) => tasks.some((candidate) => candidate.id === id && candidate.status === "completed"));
}

export function claimRoomTask(roomId: string, taskId: string, sessionId: string): RoomTask {
  const room = getRoom(roomId);
  requireMember(room, sessionId);
  const tasks = listRoomTasks(roomId);
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error("Room task not found.");
  if (task.status !== "pending") throw new Error(`Room task is already ${task.status}.`);
  if (task.assignedTo && task.assignedTo !== sessionId) throw new Error("Room task is assigned to another session.");
  if (!dependenciesComplete(task, tasks)) throw new Error("Room task dependencies are not complete.");
  const activeCount = tasks.filter((candidate) => candidate.status === "leased" || candidate.status === "running").length;
  if (activeCount >= room.coordination.maxConcurrency) throw new Error("Room concurrency limit has been reached.");
  const member = requireMember(room, sessionId);
  if (member.cwd) {
    const workspaceBusy = tasks.some((candidate) => (
      (candidate.status === "leased" || candidate.status === "running")
      && candidate.assignedTo !== sessionId
      && candidate.workspace?.cwd
      && resolve(candidate.workspace.cwd) === resolve(member.cwd!)
    ));
    if (workspaceBusy) throw new Error("This workspace already has an active room task; use a separate worktree for parallel work.");
  }
  const now = Date.now();
  task.status = "leased";
  task.assignedTo = sessionId;
  task.attempt += 1;
  task.lease = {
    holderSessionId: sessionId,
    token: randomUUID(),
    acquiredAt: now,
    heartbeatAt: now,
    expiresAt: now + room.coordination.leaseDurationMs,
  };
  if (member.cwd) {
    task.workspace = {
      cwd: member.cwd,
      ...(member.projectRoot ? { projectRoot: member.projectRoot } : {}),
      ...(member.worktreeBranch ? { worktreeBranch: member.worktreeBranch } : {}),
    };
  }
  task.updatedAt = now;
  writeTask(task);
  return task;
}

function requireLease(task: RoomTask, sessionId: string, token: string): void {
  if (!task.lease || task.lease.holderSessionId !== sessionId || task.lease.token !== token) {
    throw new Error("A valid task lease token owned by this session is required.");
  }
  if (task.lease.expiresAt <= Date.now()) throw new Error("The task lease has expired.");
}

export function heartbeatRoomTask(roomId: string, taskId: string, sessionId: string, token: string): RoomTask {
  const room = getRoom(roomId);
  const task = getRoomTask(roomId, taskId);
  requireLease(task, sessionId, token);
  const now = Date.now();
  task.status = "running";
  task.lease!.heartbeatAt = now;
  task.lease!.expiresAt = now + room.coordination.leaseDurationMs;
  task.updatedAt = now;
  writeTask(task);
  return task;
}

export function releaseRoomTaskLease(roomId: string, taskId: string, sessionId: string, token: string, reason: string): RoomTask {
  const task = getRoomTask(roomId, taskId);
  requireLease(task, sessionId, token);
  task.status = task.attempt >= task.maxAttempts ? "failed" : "pending";
  task.error = cleanText(reason, MAX_MESSAGE_LENGTH);
  task.lease = undefined;
  task.assignedTo = undefined;
  task.updatedAt = Date.now();
  writeTask(task);
  return task;
}

export function finishRoomTask(roomId: string, taskId: string, sessionId: string, token: string, input: {
  status: "completed" | "failed" | "blocked";
  result: string;
}): RoomTask {
  const task = getRoomTask(roomId, taskId);
  if (task.status === input.status && !task.lease && task.assignedTo === sessionId && task.finalizedLeaseToken === token) return task;
  requireLease(task, sessionId, token);
  task.status = input.status;
  if (input.status === "completed") task.result = cleanText(input.result, MAX_MESSAGE_LENGTH);
  else task.error = cleanText(input.result, MAX_MESSAGE_LENGTH);
  task.lease = undefined;
  task.finalizedLeaseToken = token;
  task.updatedAt = Date.now();
  writeTask(task);
  return task;
}

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
    const stat = statSync(sourcePath);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error("Artifact source must be a file no larger than 5 MB.");
    const safeName = basename(sourcePath).replace(/[^a-zA-Z0-9._-]/g, "_");
    storedPath = join(paths.artifacts, `${id}-${safeName}`);
    copyFileSync(sourcePath, storedPath);
  } else if (input.content !== undefined) {
    const safeName = basename(input.name).replace(/[^a-zA-Z0-9._-]/g, "_") || "artifact.txt";
    storedPath = join(paths.artifacts, `${id}-${safeName}`);
    writeFileSync(storedPath, input.content.slice(0, 5 * 1024 * 1024), "utf8");
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

export function subscribeRoomEvents(roomId: string, listener: RoomEventListener): () => void {
  getRoom(roomId);
  const listeners = roomEventListeners();
  const set = listeners.get(roomId) ?? new Set<RoomEventListener>();
  set.add(listener);
  listeners.set(roomId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(roomId);
  };
}

export function appendPrivateNote(roomId: string, sessionId: string, content: string): PrivateRoomNote {
  const room = getRoom(roomId);
  requireMember(room, sessionId);
  const directory = getPrivateRoomDirectory(roomId, sessionId);
  mkdirSync(directory, { recursive: true });
  const note: PrivateRoomNote = { id: randomUUID(), roomId, sessionId, content: cleanText(content, MAX_MESSAGE_LENGTH), createdAt: Date.now() };
  appendFileSync(join(directory, "notes.jsonl"), `${JSON.stringify(note)}\n`, "utf8");
  return note;
}

export function listPrivateNotes(roomId: string, sessionId: string, limit = 100): PrivateRoomNote[] {
  const room = getRoom(roomId);
  requireMember(room, sessionId);
  const path = join(getPrivateRoomDirectory(roomId, sessionId), "notes.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as PrivateRoomNote]; } catch { return []; }
  }).slice(-Math.max(1, Math.min(500, limit)));
}

export function subscribeRoom(roomId: string, listener: RoomListener): () => void {
  getRoom(roomId);
  const listeners = roomListeners();
  const set = listeners.get(roomId) ?? new Set<RoomListener>();
  set.add(listener);
  listeners.set(roomId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(roomId);
  };
}
