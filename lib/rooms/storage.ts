import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { createTeamAgentProfile, validateTeamAgentProfile } from "../team-agent-templates";
import { TEAM_DEFAULTS, type TeamAgentRole } from "../team-types";
import type {
  CollaborationRoom,
  RoomAuditEntry,
  RoomEvent,
  RoomMember,
  RoomMemberRole,
  RoomMessage,
  RoomPresence,
} from "../room-types";
import { ROOM_SCHEMA_VERSION } from "../room-types";

export const ROOM_ID_PATTERN = /^[0-9a-f-]{36}$/i;
export const MAX_MESSAGE_BYTES = TEAM_DEFAULTS.maxInputBytes;
export const MAX_ROOM_NAME_LENGTH = 120;

export type RoomListener = (message: RoomMessage) => void;
export type RoomEventListener = (event: RoomEvent) => void;

declare global {
  var __pioraRoomListeners: Map<string, Set<RoomListener>> | undefined;
  var __pioraRoomEventListeners: Map<string, Set<RoomEventListener>> | undefined;
}

export function roomEventListeners(): Map<string, Set<RoomEventListener>> {
  return globalThis.__pioraRoomEventListeners ??= new Map();
}

export function emitRoomEvent(event: RoomEvent): void {
  for (const listener of roomEventListeners().get(event.roomId) ?? []) listener(event);
}

export function roomListeners(): Map<string, Set<RoomListener>> {
  return globalThis.__pioraRoomListeners ??= new Map();
}

export function getRoomsRoot(): string {
  const root = process.env.PIORA_ROOMS_ROOT
    ? resolve(process.env.PIORA_ROOMS_ROOT)
    : resolve(getAgentDir(), "piora", "rooms");
  mkdirSync(root, { recursive: true });
  return root;
}

export function assertRoomId(roomId: string): string {
  if (!ROOM_ID_PATTERN.test(roomId)) throw new Error("Invalid collaboration room id.");
  return roomId;
}

export function roomPaths(roomId: string) {
  const root = join(getRoomsRoot(), assertRoomId(roomId));
  return {
    root,
    metadata: join(root, "room.json"),
    shared: join(root, "shared"),
    messages: join(root, "shared", "messages.jsonl"),
    messageBlobs: join(root, "shared", "message-blobs"),
    artifacts: join(root, "shared", "artifacts"),
    privateRoot: join(root, "private"),
    tasks: join(root, "shared", "tasks"),
    legacyTasks: join(root, "shared", "legacy-tasks"),
    runs: join(root, "shared", "runs"),
    audit: join(root, "shared", "audit.jsonl"),
    workspace: join(root, "workspace"),
  };
}

export function safeMemberDirectory(memberId: string): string {
  const encoded = Buffer.from(memberId, "utf8").toString("base64url");
  if (!encoded) throw new Error("A member id is required.");
  return encoded;
}

export function cleanText(value: string, maxLength: number): string {
  const cleaned = value.trim().slice(0, maxLength);
  if (!cleaned) throw new Error("A non-empty value is required.");
  return cleaned;
}

export function requireUtf8Text(value: string, label: string, maxBytes: number): string {
  if (!value.trim()) throw new Error(`${label} must not be empty.`);
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    const error = new Error(`${label} exceeds ${maxBytes} UTF-8 bytes.`) as Error & { code?: string; status?: number };
    error.code = "TEAM_INPUT_TOO_LARGE";
    error.status = 413;
    throw error;
  }
  return value;
}

export function isInside(parent: string, target: string): boolean {
  const path = relative(resolve(parent), resolve(target));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function attachMemberAliases(member: RoomMember): RoomMember {
  const aliases: PropertyDescriptorMap = {
    sessionId: { configurable: true, get: () => member.binding.sessionId, set: (value: string) => { member.binding.sessionId = value; } },
    name: { configurable: true, get: () => member.profile.name, set: (value?: string) => { if (value !== undefined) member.profile.name = value; } },
    instructions: { configurable: true, get: () => member.profile.roleDescription, set: (value?: string) => { member.profile.roleDescription = value ?? ""; } },
    role: { configurable: true, get: () => member.profile.role, set: (value: TeamAgentRole) => { member.profile.role = value; } },
    cwd: { configurable: true, get: () => member.binding.cwd, set: (value?: string) => { member.binding.cwd = value; } },
    projectRoot: { configurable: true, get: () => member.binding.projectRoot, set: (value?: string) => { member.binding.projectRoot = value; } },
    worktreeBranch: { configurable: true, get: () => member.binding.worktreeBranch, set: (value?: string) => { member.binding.worktreeBranch = value; } },
  };
  Object.defineProperties(member, aliases);
  return member;
}

export function attachRoomAliases(room: CollaborationRoom): CollaborationRoom {
  room.members = room.members.map(attachMemberAliases);
  Object.defineProperty(room.coordination, "coordinatorSessionId", {
    configurable: true,
    get: () => room.members.find((member) => member.memberId === room.coordination.coordinatorMemberId)?.binding.sessionId,
    set: (sessionId?: string) => {
      const member = room.members.find((candidate) => candidate.binding.sessionId === sessionId);
      if (member) room.coordination.coordinatorMemberId = member.memberId;
    },
  });
  return room;
}

export function withRoomLockSync<T>(roomId: string, operation: () => T): T {
  const paths = roomPaths(roomId);
  mkdirSync(paths.root, { recursive: true });
  let release: (() => void) | undefined;
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 100 && !release; attempt += 1) {
    try {
      release = lockfile.lockSync(paths.root, { realpath: false, stale: 30_000, update: 1_000 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || attempt === 99) throw error;
      Atomics.wait(waitBuffer, 0, 0, Math.min(50, 4 + attempt));
    }
  }
  if (!release) throw new Error("无法获取协作空间元数据锁。");
  try {
    return operation();
  } finally {
    release();
  }
}

export function writeRoom(room: CollaborationRoom): void {
  const paths = roomPaths(room.id);
  mkdirSync(paths.root, { recursive: true });
  const temporary = `${paths.metadata}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(room, null, 2)}\n`, "utf8");
  renameSync(temporary, paths.metadata);
}

export function appendRoomAudit(
  roomId: string,
  actorSessionId: string,
  action: RoomAuditEntry["action"],
  summary: string,
): RoomAuditEntry {
  const paths = roomPaths(roomId);
  mkdirSync(paths.shared, { recursive: true });
  const audit: RoomAuditEntry = {
    id: randomUUID(),
    roomId,
    actorSessionId,
    action,
    summary: cleanText(summary, 1_000),
    createdAt: Date.now(),
  };
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

interface LegacyRoomMember {
  memberId?: string;
  sessionId: string;
  name?: string;
  instructions?: string;
  cwd?: string;
  projectRoot?: string;
  worktreeBranch?: string;
  role?: RoomMemberRole;
  joinedAt?: number;
}

function migrateLegacyMember(member: LegacyRoomMember, now: number): RoomMember {
  const role = member.role ?? "participant";
  const profile = createTeamAgentProfile(role, {
    name: member.name?.trim() || member.sessionId.slice(0, 8),
    roleDescription: member.instructions ?? "",
  });
  return attachMemberAliases({
    memberId: member.memberId || member.sessionId,
    profile,
    binding: {
      sessionId: member.sessionId,
      ...(member.cwd ? { cwd: resolve(member.cwd) } : {}),
      ...(member.projectRoot ? { projectRoot: resolve(member.projectRoot) } : {}),
      ...(member.worktreeBranch ? { worktreeBranch: member.worktreeBranch } : {}),
      managedByPiora: false,
      boundAt: member.joinedAt ?? now,
      status: "ready",
    },
    joinedAt: member.joinedAt ?? now,
  } as RoomMember);
}

function parseRoom(value: unknown): CollaborationRoom | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (![1, 2, ROOM_SCHEMA_VERSION].includes(source.schemaVersion as number) || typeof source.id !== "string" || !ROOM_ID_PATTERN.test(source.id)) return null;
  const raw = source as unknown as Record<string, unknown> & { members: unknown[] };
  if (typeof raw.name !== "string" || typeof raw.createdAt !== "number" || typeof raw.updatedAt !== "number") return null;
  if (typeof raw.nextSeq !== "number" || !Array.isArray(raw.members) || !raw.paths) return null;
  const paths = roomPaths(source.id);
  const legacy = source.schemaVersion !== ROOM_SCHEMA_VERSION;
  const members = legacy
    ? raw.members.flatMap((item) => item && typeof (item as LegacyRoomMember).sessionId === "string" ? [migrateLegacyMember(item as LegacyRoomMember, raw.updatedAt as number)] : [])
    : raw.members.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const member = item as RoomMember;
        if (!member.memberId || !member.profile || !member.binding?.sessionId) return [];
        try {
          member.profile = validateTeamAgentProfile(member.profile);
          return [attachMemberAliases(member)];
        } catch {
          return [];
        }
      });
  if (members.length === 0) return null;
  const oldCoordination = (raw.coordination ?? {}) as Record<string, unknown>;
  const coordinator = members.find((member) => member.binding.sessionId === oldCoordination.coordinatorSessionId)
    ?? members.find((member) => member.profile.role === "coordinator")
    ?? members[0]!;
  coordinator.profile.role = "coordinator";
  for (const member of members) if (member.memberId !== coordinator.memberId && member.profile.role === "coordinator") member.profile.role = "participant";
  const room = {
    ...raw,
    schemaVersion: ROOM_SCHEMA_VERSION,
    description: typeof raw.description === "string" ? raw.description : "",
    members,
    coordination: legacy ? {
      mode: oldCoordination.mode === "coordinator" ? "team" : "manual",
      coordinatorMemberId: coordinator.memberId,
      defaultReviewerMemberIds: members.filter((member) => member.profile.role === "reviewer").map((member) => member.memberId),
      maxConcurrency: Math.max(1, Math.min(16, Number(oldCoordination.maxConcurrency) || TEAM_DEFAULTS.maxConcurrency)),
      leaseDurationMs: Math.max(30_000, Number(oldCoordination.leaseDurationMs) || TEAM_DEFAULTS.leaseDurationMs),
      maxRunSteps: TEAM_DEFAULTS.maxRunSteps,
      maxTaskAttempts: TEAM_DEFAULTS.maxTaskAttempts,
      requireReviewForCodeChanges: TEAM_DEFAULTS.requireReviewForCodeChanges,
    } : oldCoordination,
  } as unknown as CollaborationRoom;
  room.workspace = room.workspace && typeof room.workspace.path === "string"
    ? {
        mode: room.workspace.mode === "custom" ? "custom" : "managed",
        path: resolve(room.workspace.path),
        label: typeof room.workspace.label === "string" && room.workspace.label.trim() ? room.workspace.label : "共享工作区",
        instructions: typeof room.workspace.instructions === "string" ? room.workspace.instructions : "",
        defaultAgentWorkspace: room.workspace.defaultAgentWorkspace === "shared" ? "shared" : "dedicated_worktree",
      }
    : { mode: "managed", path: paths.workspace, label: "共享工作区", instructions: "", defaultAgentWorkspace: "dedicated_worktree" };
  room.paths = { root: paths.root, shared: paths.shared, privateRoot: paths.privateRoot };
  room.coordination.mode = room.coordination.mode === "team" ? "team" : "manual";
  room.coordination.coordinatorMemberId ||= coordinator.memberId;
  room.coordination.defaultReviewerMemberIds ??= members.filter((member) => member.profile.role === "reviewer").map((member) => member.memberId);
  room.coordination.maxConcurrency = Math.max(1, Math.min(16, room.coordination.maxConcurrency || TEAM_DEFAULTS.maxConcurrency));
  room.coordination.leaseDurationMs = Math.max(30_000, room.coordination.leaseDurationMs || TEAM_DEFAULTS.leaseDurationMs);
  room.coordination.maxRunSteps ||= TEAM_DEFAULTS.maxRunSteps;
  room.coordination.maxTaskAttempts ||= TEAM_DEFAULTS.maxTaskAttempts;
  room.coordination.requireReviewForCodeChanges ??= TEAM_DEFAULTS.requireReviewForCodeChanges;
  mkdirSync(room.workspace.path, { recursive: true });
  return attachRoomAliases(room);
}

export function getRoom(roomId: string): CollaborationRoom {
  const path = roomPaths(roomId).metadata;
  if (!existsSync(path)) throw new Error("Collaboration room not found.");
  const source = JSON.parse(readFileSync(path, "utf8")) as { schemaVersion?: unknown };
  const sourceVersion = source.schemaVersion;
  const room = parseRoom(source);
  if (!room) throw new Error("Collaboration room metadata is invalid.");
  if (sourceVersion !== ROOM_SCHEMA_VERSION) {
    withRoomLockSync(roomId, () => {
      const paths = roomPaths(roomId);
      const backup = `${paths.metadata}.v2.backup`;
      if (!existsSync(backup)) writeFileSync(backup, readFileSync(paths.metadata));
      if (existsSync(paths.tasks) && !existsSync(paths.legacyTasks)) renameSync(paths.tasks, paths.legacyTasks);
      writeRoom(room);
    });
  }
  return room;
}

export function listRooms(sessionId?: string): CollaborationRoom[] {
  const root = getRoomsRoot();
  const rooms: CollaborationRoom[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ROOM_ID_PATTERN.test(entry.name)) continue;
    try {
      const room = getRoom(entry.name);
      if (!sessionId || room.members.some((member) => member.binding.sessionId === sessionId)) rooms.push(room);
    } catch {
      // A partial/corrupt directory is ignored instead of breaking all rooms.
    }
  }
  return rooms.sort((left, right) => right.updatedAt - left.updatedAt);
}

export function requireMember(room: CollaborationRoom, sessionId: string): RoomMember {
  const member = room.members.find((item) => item.sessionId === sessionId);
  if (!member) throw new Error("This session is not a member of the collaboration room.");
  return member;
}

export function requireCoordinator(room: CollaborationRoom, sessionId: string): RoomMember {
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

export function emitRoomPresence(roomId: string, presence: Omit<RoomPresence, "updatedAt"> & { updatedAt?: number }): void {
  getRoom(roomId);
  emitRoomEvent({
    type: "presence",
    roomId,
    presence: { ...presence, updatedAt: presence.updatedAt ?? Date.now() },
  });
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
