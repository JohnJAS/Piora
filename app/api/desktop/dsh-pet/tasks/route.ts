import { NextResponse } from "next/server";
import { getRunningRpcSessionStatuses } from "@/lib/rpc-manager";
import { requireHarmonyDesktopAccess } from "../../../harmony/_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireHarmonyDesktopAccess(request);
  if (denied) return denied;
  // Retain terminal snapshots so cancelled tasks never look like successful ones.
  const tasks = getRunningRpcSessionStatuses(true).map(task => ({
    id: task.id, runtime: task.runtime, pendingApproval: task.pendingApproval,
    ...(task.activity ? { activity: { kind: task.activity.kind, updatedAt: task.activity.updatedAt } } : {}),
    ...(task.taskRun ? { taskRun: { phase: task.taskRun.phase, attempt: task.taskRun.attempt, updatedAt: task.taskRun.updatedAt } } : {}),
  }));
  return NextResponse.json({ tasks }, { headers: { "Cache-Control": "no-store" } });
}
