import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { APP_DISPLAY_NAME } from "../branding";
import type { CollaborationRoom, RoomMember, RoomMemberRole } from "../room-types";
import { ROOM_SCHEMA_VERSION } from "../room-types";
import { createTeamAgentProfile, validateTeamAgentProfile } from "../team-agent-templates";
import { TEAM_DEFAULTS, type TeamAgentBinding, type TeamAgentProfile } from "../team-types";
import { appendRoomMessage } from "./messages";
import {
  appendRoomAudit,
  attachMemberAliases,
  attachRoomAliases,
  cleanText,
  emitRoomEvent,
  getRoom,
  getRoomsRoot,
  isInside,
  listRooms,
  MAX_ROOM_NAME_LENGTH,
  requireCoordinator,
  requireMember,
  roomEventListeners,
  roomListeners,
  roomPaths,
  safeMemberDirectory,
  withRoomLockSync,
  writeRoom,
} from "./storage";
import { listRoomTasks, writeTask } from "./tasks";

// Remember contamination before moving the first binding: the remaining room
// must also stop using the old shared history even after it becomes its sole owner.
function hasSharedRoomHistory(roomId: string, sessionId: string): boolean {
  const marker = join(getRoomsRoot(), ".shared-session-histories", createHash("sha256").update(sessionId).digest("hex"));
  if (existsSync(marker)) return true;
  if (!listRooms(sessionId).some((room) => room.id !== roomId)) return false;
  mkdirSync(join(getRoomsRoot(), ".shared-session-histories"), { recursive: true });
  writeFileSync(marker, "shared\n", { flush: true });
  return true;
}

/** Replace reused histories atomically; callers create a durable empty session first. */
export function isolateRoomMemberSessions(roomId: string, options: {
  isBusy: (room: CollaborationRoom, member: RoomMember) => boolean;
  create: (room: CollaborationRoom, member: RoomMember) => TeamAgentBinding;
}): CollaborationRoom {
  let changed = false;
  const saved = withRoomLockSync(roomId, () => {
    const room = getRoom(roomId);
    for (const member of room.members) {
      if (member.binding.status === "provisioning") continue;
      const shared = hasSharedRoomHistory(roomId, member.sessionId);
      if (member.binding.managedByPiora && !shared) continue;
      const tasks = listRoomTasks(roomId);
      if (
        options.isBusy(room, member)
        || tasks.some((task) => task.assignedTo === member.sessionId && ["leased", "running"].includes(task.status))
      ) continue;
      const previousSessionId = member.sessionId;
      member.binding = options.create(room, member);
      for (const task of tasks) {
        if (task.status === "pending" && task.assignedTo === previousSessionId) {
          task.assignedTo = member.sessionId;
          task.updatedAt = Date.now();
          writeTask(task);
        }
      }
      changed = true;
    }
    if (changed) {
      room.updatedAt = Date.now();
      writeRoom(room);
    }
    return room;
  });
  if (changed) {
    appendRoomAudit(roomId, "piora", "member.updated", "已为复用的成员创建独立群聊会话，原会话历史保留。");
    emitRoomEvent({ type: "room", roomId, room: saved });
  }
  return saved;
}

export function assertRoomSessionIsolated(roomId: string, sessionId: string): void {
  const member = getRoom(roomId).members.find((candidate) => candidate.sessionId === sessionId);
  if (!member?.binding.managedByPiora || member.binding.status === "provisioning" || hasSharedRoomHistory(roomId, sessionId)) {
    const error = new Error("群聊会话尚未隔离，请等待当前任务结束后刷新群聊重试。原会话历史会保留。") as Error & { code: string; status: number };
    error.code = "TEAM_REVISION_CONFLICT";
    error.status = 409;
    throw error;
  }
}

export function createRoom(input: {
  roomId?: string;
  name: string;
  description?: string;
  projectRoot?: string;
  creator: {
    memberId?: string;
    sessionId: string;
    name?: string;
    instructions?: string;
    cwd?: string;
    projectRoot?: string;
    worktreeBranch?: string;
    role?: RoomMemberRole;
    profile?: Partial<TeamAgentProfile>;
  };
}): CollaborationRoom {
  const id = input.roomId ?? randomUUID();
  const now = Date.now();
  const paths = roomPaths(id);
  if (existsSync(paths.metadata)) throw new Error("Room already exists.");
  mkdirSync(paths.artifacts, { recursive: true });
  mkdirSync(paths.privateRoot, { recursive: true });
  mkdirSync(paths.workspace, { recursive: true });
  const role = input.creator.role ?? "coordinator";
  const creator = attachMemberAliases({
    memberId: input.creator.memberId ?? randomUUID(),
    profile: createTeamAgentProfile(role, {
      ...input.creator.profile,
      name: input.creator.name ?? input.creator.profile?.name ?? input.creator.sessionId.slice(0, 8),
      roleDescription: input.creator.instructions ?? input.creator.profile?.roleDescription ?? "",
    }),
    binding: {
      sessionId: input.creator.sessionId,
      ...(input.creator.cwd ? { cwd: resolve(input.creator.cwd) } : {}),
      ...(input.creator.projectRoot ? { projectRoot: resolve(input.creator.projectRoot) } : {}),
      ...(input.creator.worktreeBranch ? { worktreeBranch: input.creator.worktreeBranch } : {}),
      managedByPiora: false,
      boundAt: now,
      status: "ready",
    },
    joinedAt: now,
  } as RoomMember);
  const room = attachRoomAliases({
    schemaVersion: ROOM_SCHEMA_VERSION,
    id,
    name: cleanText(input.name, MAX_ROOM_NAME_LENGTH),
    description: input.description?.trim().slice(0, 2_000) ?? "",
    ...(input.projectRoot ? { projectRoot: resolve(input.projectRoot) } : {}),
    createdAt: now,
    updatedAt: now,
    nextSeq: 1,
    members: [creator],
    coordination: {
      mode: "manual",
      coordinatorMemberId: creator.memberId,
      defaultReviewerMemberIds: [],
      maxConcurrency: TEAM_DEFAULTS.maxConcurrency,
      leaseDurationMs: TEAM_DEFAULTS.leaseDurationMs,
      maxRunSteps: TEAM_DEFAULTS.maxRunSteps,
      maxTaskAttempts: TEAM_DEFAULTS.maxTaskAttempts,
      requireReviewForCodeChanges: TEAM_DEFAULTS.requireReviewForCodeChanges,
    },
    workspace: { mode: "managed", path: paths.workspace, label: "共享工作区", instructions: "", defaultAgentWorkspace: "dedicated_worktree" },
    paths: { root: paths.root, shared: paths.shared, privateRoot: paths.privateRoot },
  } as CollaborationRoom);
  mkdirSync(join(paths.privateRoot, safeMemberDirectory(creator.memberId)), { recursive: true });
  writeRoom(room);
  appendRoomAudit(id, creator.sessionId, "room.created", `创建协作空间「${room.name}」。`);
  emitRoomEvent({ type: "room", roomId: room.id, room });
  appendRoomMessage(id, {
    authorKind: "system",
    authorId: "piora",
    authorName: `${APP_DISPLAY_NAME}`,
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
  const existing = room.members.find((member) => member.sessionId === input.sessionId);
  if (existing) {
    existing.name = input.name ?? existing.name;
    existing.cwd = input.cwd ?? existing.cwd;
    existing.projectRoot = input.projectRoot ?? existing.projectRoot;
    existing.worktreeBranch = input.worktreeBranch ?? existing.worktreeBranch;
    existing.role = input.role ?? existing.role;
    existing.instructions = input.instructions ?? existing.instructions;
  } else {
    const role = input.role ?? "participant";
    room.members.push(attachMemberAliases({
      memberId: input.memberId ?? randomUUID(),
      profile: createTeamAgentProfile(role, {
        name: input.name?.trim() || input.sessionId.slice(0, 8),
        roleDescription: input.instructions ?? "",
      }),
      binding: {
        sessionId: input.sessionId,
        ...(input.cwd ? { cwd: resolve(input.cwd) } : {}),
        ...(input.projectRoot ? { projectRoot: resolve(input.projectRoot) } : {}),
        ...(input.worktreeBranch ? { worktreeBranch: input.worktreeBranch } : {}),
        managedByPiora: false,
        boundAt: Date.now(),
        status: "ready",
      },
      joinedAt: Date.now(),
    } as RoomMember));
  }
  room.updatedAt = Date.now();
  const saved = room.members.find((member) => member.sessionId === input.sessionId)!;
  if (saved.role === "coordinator") {
    for (const member of room.members) if (member.memberId !== saved.memberId && member.role === "coordinator") member.role = "participant";
    room.coordination.coordinatorMemberId = saved.memberId;
  }
  room.coordination.defaultReviewerMemberIds = room.members.filter((member) => member.role === "reviewer").map((member) => member.memberId);
  mkdirSync(join(room.paths.privateRoot, safeMemberDirectory(saved.memberId)), { recursive: true });
  writeRoom(room);
  appendRoomAudit(roomId, input.requestedBy ?? input.sessionId, existing ? "member.updated" : "member.added", existing
    ? `更新智能体「${saved.name || saved.sessionId}」的资料。`
    : `智能体「${saved.name || saved.sessionId}」加入协作空间。`);
  emitRoomEvent({ type: "room", roomId: room.id, room });
  if (!existing) {
    appendRoomMessage(roomId, {
      authorKind: "system",
      authorId: "piora",
      authorName: `${APP_DISPLAY_NAME}`,
      content: `${input.name || input.sessionId} 加入了协作空间。`,
    });
  }
  return getRoom(roomId);
}

export function addManagedRoomMember(roomId: string, input: {
  memberId: string;
  profile: TeamAgentProfile;
  binding: TeamAgentBinding;
  requestedBy: string;
}): CollaborationRoom {
  let saved!: CollaborationRoom;
  withRoomLockSync(roomId, () => {
    const room = getRoom(roomId);
    requireCoordinator(room, input.requestedBy);
    if (room.members.some((member) => member.memberId === input.memberId)) {
      throw new Error("该智能体已存在于协作空间中。");
    }
    if (room.members.some((member) => member.binding.sessionId === input.binding.sessionId)) {
      throw new Error("该会话已绑定到协作空间中的其他智能体。");
    }
    const profile = validateTeamAgentProfile(structuredClone(input.profile));
    const binding = structuredClone(input.binding);
    if (!binding.sessionId || !binding.managedByPiora) {
      throw new Error(`托管智能体必须绑定到由 ${APP_DISPLAY_NAME} 创建的会话。`);
    }
    if (binding.cwd) binding.cwd = resolve(binding.cwd);
    if (binding.projectRoot) binding.projectRoot = resolve(binding.projectRoot);
    const member = attachMemberAliases({
      memberId: input.memberId,
      profile,
      binding,
      joinedAt: Date.now(),
    } as RoomMember);
    room.members.push(member);
    if (profile.role === "coordinator") {
      for (const candidate of room.members) {
        if (candidate.memberId !== member.memberId && candidate.profile.role === "coordinator") {
          candidate.profile.role = "participant";
        }
      }
      room.coordination.coordinatorMemberId = member.memberId;
    }
    room.coordination.defaultReviewerMemberIds = room.members
      .filter((candidate) => candidate.profile.role === "reviewer")
      .map((candidate) => candidate.memberId);
    room.updatedAt = Date.now();
    mkdirSync(join(room.paths.privateRoot, safeMemberDirectory(member.memberId)), { recursive: true });
    writeRoom(room);
    saved = room;
  });
  appendRoomAudit(roomId, input.requestedBy, "member.added", `托管智能体「${input.profile.name}」加入协作空间。`);
  emitRoomEvent({ type: "room", roomId, room: saved });
  appendRoomMessage(roomId, {
    authorKind: "system",
    authorId: "piora",
    authorName: `${APP_DISPLAY_NAME}`,
    content: `${input.profile.name} 加入了协作空间。`,
  });
  return getRoom(roomId);
}

export function removeRoomMember(roomId: string, sessionId: string, requestedBy?: string): CollaborationRoom {
  const room = getRoom(roomId);
  if (requestedBy) {
    const requester = requireMember(room, requestedBy);
    if (requestedBy !== sessionId && requester.role !== "coordinator" && room.coordination.coordinatorSessionId !== requestedBy) {
      throw new Error("只有协调者可以移出其他智能体。");
    }
  }
  const member = room.members.find((item) => item.sessionId === sessionId);
  if (!member) return room;
  if (room.members.length === 1) throw new Error("协作空间至少需要保留一个智能体。");
  const activeTask = listRoomTasks(roomId).find((task) => task.assignedTo === sessionId && (task.status === "leased" || task.status === "running"));
  if (activeTask) throw new Error("请先完成或释放该智能体的运行中任务，再将其移出。");
  for (const task of listRoomTasks(roomId)) {
    if (task.assignedTo === sessionId && task.status === "pending") {
      task.assignedTo = undefined;
      task.updatedAt = Date.now();
      writeTask(task);
    }
  }
  room.members = room.members.filter((item) => item.sessionId !== sessionId);
  room.coordination.defaultReviewerMemberIds = room.members.filter((candidate) => candidate.role === "reviewer").map((candidate) => candidate.memberId);
  if (room.coordination.coordinatorSessionId === sessionId || member.role === "coordinator") {
    const replacement = room.members[0];
    replacement.role = "coordinator";
    room.coordination.coordinatorMemberId = replacement.memberId;
  }
  room.updatedAt = Date.now();
  writeRoom(room);
  appendRoomAudit(roomId, requestedBy ?? sessionId, "member.removed", `将智能体「${member.name || member.sessionId}」移出协作空间。`);
  emitRoomEvent({ type: "room", roomId: room.id, room });
  appendRoomMessage(roomId, {
    authorKind: "system",
    authorId: "piora",
    authorName: `${APP_DISPLAY_NAME}`,
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
    appendRoomMessage(roomId, {
      authorKind: "system",
      authorId: "piora",
      authorName: `${APP_DISPLAY_NAME}`,
      content: `协作空间已从「${previousName}」更名为「${room.name}」。`,
    });
  }
  return getRoom(roomId);
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
  const memberRoots = room.members.flatMap((member) => [member.projectRoot, member.cwd]).filter((root): root is string => Boolean(root));
  if (input.mode === "custom" && !memberRoots.some((root) => isInside(root, workspacePath))) {
    throw new Error("The shared workspace must stay inside one of the room members' projects.");
  }
  mkdirSync(workspacePath, { recursive: true });
  room.workspace = {
    mode: input.mode,
    path: workspacePath,
    label: input.label?.trim().slice(0, 120) || "共享工作区",
    instructions: input.instructions?.trim().slice(0, 4_000) ?? "",
    defaultAgentWorkspace: room.workspace.defaultAgentWorkspace ?? "dedicated_worktree",
  };
  room.updatedAt = Date.now();
  writeRoom(room);
  appendRoomAudit(roomId, requestedBy, "workspace.updated", `将共享工作区修改为 ${workspacePath}。`);
  emitRoomEvent({ type: "room", roomId, room });
  appendRoomMessage(roomId, {
    authorKind: "system",
    authorId: "piora",
    authorName: `${APP_DISPLAY_NAME}`,
    content: `共享工作区已修改为 ${workspacePath}。`,
  });
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
  if (!member) throw new Error("未找到协作智能体。");
  const previousSessionId = member.sessionId;
  const nextSessionId = input.sessionId ?? previousSessionId;
  if (room.coordination.coordinatorSessionId === previousSessionId && input.role && input.role !== "coordinator") {
    throw new Error("更改协调者角色前，请先将协调权转交给其他智能体。");
  }
  if (nextSessionId !== previousSessionId && room.members.some((candidate) => candidate.sessionId === nextSessionId)) {
    throw new Error("该会话已绑定到协作空间中的其他智能体。");
  }
  if (input.projectRoot && room.projectRoot && resolve(input.projectRoot) !== resolve(room.projectRoot)) {
    throw new Error("该会话属于其他项目，无法绑定到这个智能体。");
  }
  if (nextSessionId !== previousSessionId) {
    const activeTask = listRoomTasks(roomId).find((task) => task.assignedTo === previousSessionId && (task.status === "leased" || task.status === "running"));
    if (activeTask) throw new Error("更换会话前，请先完成或释放该智能体的运行中任务。");
    for (const task of listRoomTasks(roomId)) {
      if (task.assignedTo === previousSessionId && task.status === "pending") {
        task.assignedTo = nextSessionId;
        task.updatedAt = Date.now();
        writeTask(task);
      }
    }
    if (room.coordination.coordinatorSessionId === previousSessionId) room.coordination.coordinatorSessionId = nextSessionId;
    // Rebinding a managed member to an existing chat does not transfer ownership.
    member.binding.managedByPiora = false;
  }
  member.sessionId = nextSessionId;
  member.name = input.name?.trim().slice(0, 120) || member.name || nextSessionId.slice(0, 8);
  member.instructions = input.instructions?.trim().slice(0, 4_000) ?? member.instructions ?? "";
  member.role = input.role ?? member.role;
  member.profile.revision += 1;
  member.cwd = input.cwd ?? member.cwd;
  member.projectRoot = input.projectRoot ?? member.projectRoot;
  member.worktreeBranch = input.worktreeBranch;
  if (member.role === "coordinator") {
    for (const candidate of room.members) if (candidate.memberId !== member.memberId && candidate.role === "coordinator") candidate.role = "participant";
    room.coordination.coordinatorSessionId = member.sessionId;
  }
  room.coordination.defaultReviewerMemberIds = room.members.filter((candidate) => candidate.role === "reviewer").map((candidate) => candidate.memberId);
  room.updatedAt = Date.now();
  writeRoom(room);
  appendRoomAudit(roomId, requestedBy, "member.updated", `更新智能体「${member.name || member.sessionId}」的身份与职责。`);
  emitRoomEvent({ type: "room", roomId, room });
  appendRoomMessage(roomId, {
    authorKind: "system",
    authorId: "piora",
    authorName: `${APP_DISPLAY_NAME}`,
    content: nextSessionId === previousSessionId ? `${member.name} 的身份与职责已更新。` : `${member.name} 已换绑到会话 ${nextSessionId.slice(0, 8)}。`,
  });
  return getRoom(roomId);
}

export function updateRoomAgentProfile(
  roomId: string,
  requestedBy: string,
  memberId: string,
  expectedRevision: number,
  patch: Partial<Omit<TeamAgentProfile, "schemaVersion" | "revision">>,
  binding?: Pick<TeamAgentBinding, "sessionId" | "cwd" | "projectRoot" | "worktreeBranch">,
): CollaborationRoom {
  let room!: CollaborationRoom;
  withRoomLockSync(roomId, () => {
    room = getRoom(roomId);
    requireCoordinator(room, requestedBy);
    const member = room.members.find((candidate) => candidate.memberId === memberId);
    if (!member) throw new Error("未找到协作智能体。");
    if (member.profile.revision !== expectedRevision) {
      const error = new Error("保存前智能体配置已发生变化，请刷新后重试。") as Error & { code?: string; status?: number };
      error.code = "TEAM_REVISION_CONFLICT";
      error.status = 409;
      throw error;
    }
    if (member.memberId === room.coordination.coordinatorMemberId && patch.role && patch.role !== "coordinator") {
      throw new Error("Transfer coordination before changing the coordinator role.");
    }
    const nextSessionId = binding?.sessionId ?? member.binding.sessionId;
    const rebinding = nextSessionId !== member.binding.sessionId;
    if (rebinding) {
      if (room.members.some(candidate => candidate.memberId !== memberId && candidate.binding.sessionId === nextSessionId)) {
        throw new Error("该会话已绑定到其他智能体。");
      }
      if (binding?.projectRoot && room.projectRoot && resolve(binding.projectRoot) !== resolve(room.projectRoot)) {
        throw new Error("该会话属于其他项目。");
      }
      // Pending tasks must retain their original assignee. Rebind only an idle member.
      if (listRoomTasks(roomId).some(task => task.assignedTo === member.binding.sessionId && ["pending", "leased", "running"].includes(task.status))) {
        throw new Error("更换会话前，请先完成或释放该智能体的任务。");
      }
    }
    member.profile = validateTeamAgentProfile({
      ...member.profile,
      ...structuredClone(patch),
      schemaVersion: 1,
      revision: member.profile.revision + 1,
    });
    if (rebinding && binding) member.binding = { ...member.binding, ...binding, managedByPiora: false, boundAt: Date.now(), status: "ready" };
    if (member.binding.managedByPiora) member.binding.status = "needs_restart";
    attachMemberAliases(member);
    if (member.profile.role === "coordinator") {
      for (const candidate of room.members) {
        if (candidate.memberId !== member.memberId && candidate.profile.role === "coordinator") candidate.profile.role = "participant";
      }
      room.coordination.coordinatorMemberId = member.memberId;
    }
    room.coordination.defaultReviewerMemberIds = room.members
      .filter((candidate) => candidate.profile.role === "reviewer")
      .map((candidate) => candidate.memberId);
    room.updatedAt = Date.now();
    writeRoom(room);
  });
  const savedMember = room.members.find((candidate) => candidate.memberId === memberId)!;
  appendRoomAudit(roomId, requestedBy, "member.updated", `更新智能体「${savedMember.profile.name}」的配置。`);
  emitRoomEvent({ type: "room", roomId: room.id, room });
  return getRoom(roomId);
}

export function updateRoomAgentBinding(
  roomId: string,
  requestedBy: string,
  memberId: string,
  binding: Partial<RoomMember["binding"]> & { sessionId?: string },
): CollaborationRoom {
  let saved!: CollaborationRoom;
  withRoomLockSync(roomId, () => {
    const room = getRoom(roomId);
    requireCoordinator(room, requestedBy);
    const member = room.members.find((candidate) => candidate.memberId === memberId);
    if (!member) throw new Error("未找到协作智能体。");
    const sessionId = binding.sessionId ?? member.binding.sessionId;
    if (room.members.some((candidate) => candidate.memberId !== memberId && candidate.binding.sessionId === sessionId)) {
      throw new Error("该会话已绑定到协作空间中的其他智能体。");
    }
    member.binding = {
      ...member.binding,
      ...structuredClone(binding),
      sessionId,
      boundAt: binding.boundAt ?? Date.now(),
    };
    attachMemberAliases(member);
    room.updatedAt = Date.now();
    writeRoom(room);
    saved = room;
  });
  appendRoomAudit(
    roomId,
    requestedBy,
    "member.updated",
    `更新智能体「${saved.members.find((member) => member.memberId === memberId)?.profile.name ?? memberId}」的会话绑定。`,
  );
  emitRoomEvent({ type: "room", roomId, room: saved });
  return getRoom(roomId);
}

export function configureRoomCoordination(roomId: string, input: {
  mode: "manual" | "coordinator" | "team";
  coordinatorSessionId?: string;
  maxConcurrency?: number;
  leaseDurationMs?: number;
  requestedBy?: string;
}): CollaborationRoom {
  const room = getRoom(roomId);
  if (input.requestedBy) requireCoordinator(room, input.requestedBy);
  if (input.coordinatorSessionId) requireMember(room, input.coordinatorSessionId);
  const coordinator = input.coordinatorSessionId
    ? room.members.find((member) => member.sessionId === input.coordinatorSessionId)
    : room.members.find((member) => member.memberId === room.coordination.coordinatorMemberId);
  room.coordination = {
    ...room.coordination,
    mode: input.mode === "manual" ? "manual" : "team",
    coordinatorMemberId: coordinator?.memberId ?? room.coordination.coordinatorMemberId,
    maxConcurrency: Math.max(1, Math.min(16, Math.floor(input.maxConcurrency ?? room.coordination?.maxConcurrency ?? 2))),
    leaseDurationMs: Math.max(30_000, Math.min(60 * 60_000, Math.floor(input.leaseDurationMs ?? room.coordination?.leaseDurationMs ?? 5 * 60_000))),
  };
  attachRoomAliases(room);
  if (input.coordinatorSessionId) {
    for (const member of room.members) {
      if (member.sessionId === input.coordinatorSessionId) member.role = "coordinator";
      else if (member.role === "coordinator") member.role = "participant";
    }
  }
  room.updatedAt = Date.now();
  writeRoom(room);
  appendRoomAudit(
    roomId,
    input.requestedBy ?? input.coordinatorSessionId ?? "piora",
    "coordination.updated",
    `编排模式已设为${room.coordination.mode === "team" ? "协调者编排" : "手动协作"}，最大并发 ${room.coordination.maxConcurrency}。`,
  );
  emitRoomEvent({ type: "room", roomId, room });
  return room;
}
