import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getAgentRuntimeProfile } from "./agent-runtime-profile";
import { resolveSessionAgentRuntimeProfile } from "./agent-profile-store";
import { getRpcSession, startRpcSession } from "./rpc-manager";
import {
  claimRoomTask,
  getRoom,
  listRoomTasks,
  releaseRoomTaskLease,
} from "./room-store";
import { resolveSessionPath } from "./session-reader";
import type { RoomMember, RoomTask } from "./room-types";

export interface RoomDispatchResult {
  dispatched: Array<{ taskId: string; sessionId: string }>;
  skipped: Array<{ taskId: string; reason: string }>;
}

function candidateMembers(room: ReturnType<typeof getRoom>, task: RoomTask): RoomMember[] {
  const ordered = [...room.members].sort((left, right) => {
    const rank = (member: RoomMember) => ({ worker: 0, participant: 1, planner: 2, reviewer: 3, coordinator: 4 })[member.role];
    return rank(left) - rank(right) || left.joinedAt - right.joinedAt;
  });
  return task.assignedTo ? ordered.filter((member) => member.sessionId === task.assignedTo) : ordered;
}

async function dispatchTask(roomId: string, task: RoomTask, member: RoomMember): Promise<void> {
  const room = getRoom(roomId);
  const runtimeProfile = getAgentRuntimeProfile();
  const existing = getRpcSession(member.sessionId);
  if (existing?.isRunning()) throw new Error("Session is already busy.");
  let session = existing;
  if (!session?.isAlive()) {
    const filePath = await resolveSessionPath(member.sessionId);
    if (!filePath) throw new Error("Session file was not found.");
    await resolveSessionAgentRuntimeProfile(member.sessionId, runtimeProfile);
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? member.cwd ?? process.cwd();
    session = (await startRpcSession(member.sessionId, filePath, cwd, { runtimeProfile })).session;
  }
  const claimed = claimRoomTask(roomId, task.id, member.sessionId);
  try {
    await session.send({
      type: "prompt",
      message: [
        "[PIORA COORDINATOR TASK]",
        `Room ID: ${roomId}`,
        `Task ID: ${claimed.id}`,
        `Lease token: ${claimed.lease!.token}`,
        `Title: ${claimed.title}`,
        `Description: ${claimed.description}`,
        `Your team identity: ${member.name || member.sessionId} (${member.role})`,
        `Your responsibility: ${member.instructions || "Complete the assigned task and report reusable results."}`,
        `Shared workspace: ${room.workspace.path}`,
        `Workspace contract: ${room.workspace.instructions || "Avoid overwriting another Agent's active work."}`,
        `Workspace: ${claimed.workspace?.cwd ?? member.cwd ?? "unknown"}`,
        `Worktree branch: ${claimed.workspace?.worktreeBranch ?? member.worktreeBranch ?? "main/unknown"}`,
        "Work only on this leased task. Use piora_room heartbeat_task during long work, then complete_task, fail_task, or block_task with the exact lease token. Broadcast reusable results to the room.",
      ].join("\n"),
    });
  } catch (error) {
    releaseRoomTaskLease(roomId, claimed.id, member.sessionId, claimed.lease!.token, `Dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function dispatchReadyRoomTasks(roomId: string): Promise<RoomDispatchResult> {
  const room = getRoom(roomId);
  if (room.coordination.mode !== "coordinator") throw new Error("Coordinator mode is not enabled for this room.");
  const result: RoomDispatchResult = { dispatched: [], skipped: [] };
  const busyMembers = new Set(
    listRoomTasks(roomId)
      .filter((task) => task.status === "leased" || task.status === "running")
      .map((task) => task.assignedTo)
      .filter((id): id is string => Boolean(id)),
  );
  const pending = listRoomTasks(roomId).filter((task) => task.status === "pending");
  for (const task of pending) {
    let dispatched = false;
    for (const member of candidateMembers(room, task)) {
      if (busyMembers.has(member.sessionId)) continue;
      try {
        await dispatchTask(roomId, task, member);
        busyMembers.add(member.sessionId);
        result.dispatched.push({ taskId: task.id, sessionId: member.sessionId });
        dispatched = true;
        break;
      } catch (error) {
        result.skipped.push({ taskId: task.id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!dispatched && !result.skipped.some((item) => item.taskId === task.id)) {
      result.skipped.push({ taskId: task.id, reason: "No available room member." });
    }
  }
  return result;
}
