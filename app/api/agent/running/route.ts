import { NextResponse } from "next/server";
import { getRunningRpcSessionStatuses } from "@/lib/rpc-running-status";
import { createRunningSessionsPayload } from "@/lib/task-status";
import { getSubagentPresenceVersion, readSubagentChanges } from "@/lib/subagent-store";
import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import { isSessionVisibleInAgentRuntimeProfile, readAgentProfileStore } from "@/lib/agent-profile-store";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const cursor = Number(query.get("subagentsAfter") ?? -1);
  const updates = readSubagentChanges(query.get("subagentsEpoch"), Number.isSafeInteger(cursor) ? cursor : -1);
  if (updates.subagentChanges.length) {
    const profile = getAgentRuntimeProfile();
    const profileStore = readAgentProfileStore();
    updates.subagentChanges = updates.subagentChanges.filter(id => isSessionVisibleInAgentRuntimeProfile(id, profile, profileStore));
  }
  return NextResponse.json(
    { ...createRunningSessionsPayload(getRunningRpcSessionStatuses()), ...updates, subagentPresenceVersion: getSubagentPresenceVersion() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
