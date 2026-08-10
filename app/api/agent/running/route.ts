import { NextResponse } from "next/server";
import { getRunningRpcSessionStatuses } from "@/lib/rpc-manager";
import { createRunningSessionsPayload } from "@/lib/task-status";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET() {
  return NextResponse.json(
    createRunningSessionsPayload(getRunningRpcSessionStatuses()),
    { headers: { "Cache-Control": "no-store" } },
  );
}
