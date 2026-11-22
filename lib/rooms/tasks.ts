import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RoomTask } from "../room-types";
import {
  cleanText,
  emitRoomEvent,
  getRoom,
  requireMember,
  ROOM_ID_PATTERN,
  roomPaths,
} from "./storage";

function taskPath(roomId: string, taskId: string): string {
  if (!ROOM_ID_PATTERN.test(taskId)) throw new Error("Invalid room task id.");
  return join(roomPaths(roomId).tasks, `${taskId}.json`);
}

export function writeTask(task: RoomTask): void {
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
  if (!existsSync(path)) throw new Error("未找到协作任务。");
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
    description: cleanText(input.description, 64 * 1024),
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
  if (!task) throw new Error("未找到协作任务。");
  if (task.status !== "pending") throw new Error(`协作任务当前状态为 ${task.status}，无法重复领取。`);
  if (task.assignedTo && task.assignedTo !== sessionId) throw new Error("协作任务已分配给其他会话。");
  if (!dependenciesComplete(task, tasks)) throw new Error("协作任务的依赖项尚未完成。");
  const activeCount = tasks.filter((candidate) => candidate.status === "leased" || candidate.status === "running").length;
  if (activeCount >= room.coordination.maxConcurrency) throw new Error("已达到协作空间的最大并发数。");
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
  task.error = cleanText(reason, 64 * 1024);
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
  if (input.status === "completed") task.result = cleanText(input.result, 64 * 1024);
  else task.error = cleanText(input.result, 64 * 1024);
  task.lease = undefined;
  task.finalizedLeaseToken = token;
  task.updatedAt = Date.now();
  writeTask(task);
  return task;
}
