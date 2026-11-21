import { NextResponse } from "next/server";
import { getSubagentRuntime } from "@/lib/subagent-runtime";
import { forgetEmptySubagentParent, listSubagentRecords } from "@/lib/subagent-store";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import { isSessionVisibleInAgentRuntimeProfile, readAgentProfileStore } from "@/lib/agent-profile-store";
import { compareSubagents, isSubagentId, projectSubagent, projectSubagentDetail } from "@/lib/subagent-types";
import { readSubagentResult, readSubagentTranscript, StaleSubagentTranscript } from "@/lib/subagent-transcript";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { assertSessionNotMutating } from "@/lib/session-mutation";

export const dynamic = "force-dynamic";
const pageSize = 20;
const headers = { "Cache-Control": "no-store" };

function savedRecords(id: string) {
  return listSubagentRecords(id).map(record => record.status === "running"
    ? { ...record, status: "interrupted" as const, error: "Application stopped before task completion", revision: (record.revision ?? 0) + 1 }
    : record);
}

async function canReadParent(id: string): Promise<boolean> {
  if (!isSubagentId(id)) return false;
  const profile = getAgentRuntimeProfile();
  if (!isSessionVisibleInAgentRuntimeProfile(id, profile, readAgentProfileStore())) return false;
  const live = getRpcSession(id);
  if (live?.isAlive() && live.runtimeProfile === profile && !live.isSubagentSession() && getSubagentRuntime(id)) return true;
  const path = await resolveSessionPath(id);
  try { return Boolean(path && readSessionHeader(path)?.id === id); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!await canReadParent(id)) return NextResponse.json({ error: "Conversation not found" }, { status: 404, headers });
    assertSessionNotMutating(id);
    const query = new URL(request.url).searchParams;
    const view = query.get("view") ?? "detail";
    const agentId = query.get("agentId");
    const toolCallId = query.get("toolCallId");
    const offset = Number(query.get("offset") ?? "0");
    if (!["list", "detail"].includes(view) || agentId !== null && !isSubagentId(agentId)
      || toolCallId !== null && toolCallId.length > 512 || !Number.isSafeInteger(offset) || offset < 0) throw new TypeError("Invalid subagent query");

    const runtime = getSubagentRuntime(id);
    const records = runtime?.list() ?? savedRecords(id);
    const visible = records.filter(record => record.parentSessionId === id);
    const selected = visible.filter(record => (!agentId || record.agentId === agentId) && (!toolCallId || record.parentToolCallId === toolCallId));
    if (view === "list") {
      if (!agentId && !toolCallId && !records.length) forgetEmptySubagentParent(id);
      const sorted = selected.map(projectSubagent).sort(compareSubagents);
      return NextResponse.json({ records: sorted.slice(offset, offset + pageSize), total: sorted.length,
        nextOffset: offset + pageSize < sorted.length ? offset + pageSize : null }, { headers });
    }
    const exact = Boolean(agentId || toolCallId);
    const projected = (exact ? selected : selected.slice(0, pageSize)).map(projectSubagentDetail);
    const transcript = query.get("transcript") === "true" && exact && selected.length === 1
      ? await readSubagentTranscript(selected[0], query.get("before"), request.signal) : undefined;
    const fullResult = query.get("fullResult") === "true" && agentId && selected.length === 1
      ? await readSubagentResult(selected[0], request.signal) : undefined;
    if ((transcript !== undefined || fullResult !== undefined) && !await canReadParent(id)) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404, headers });
    }
    assertSessionNotMutating(id);
    return NextResponse.json({ records: projected, transcript, fullResult }, { headers });
  } catch (error) {
    const status = error instanceof TypeError ? 400 : error instanceof StaleSubagentTranscript ? 409 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not read subagent history" : (error as Error).message }, { status, headers });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await parseJsonWithinLimit(request, 1024) as { action?: unknown; agentId?: unknown; expectedAttempt?: unknown };
    if (!body || body.action !== "stop" || typeof body.agentId !== "string" || !isSubagentId(body.agentId)
      || typeof body.expectedAttempt !== "number" || !Number.isSafeInteger(body.expectedAttempt) || body.expectedAttempt < 1
      || Object.keys(body).some(key => !["action", "agentId", "expectedAttempt"].includes(key))) throw new TypeError("Expected an owned agentId and attempt for stop");
    if (!await canReadParent(id)) return NextResponse.json({ error: "Conversation not found" }, { status: 404, headers });
    assertSessionNotMutating(id);
    const runtime = getSubagentRuntime(id);
    if (!runtime) {
      const record = savedRecords(id).find(item => item.agentId === body.agentId && (item.attempt ?? 1) === body.expectedAttempt);
      if (record) return NextResponse.json({ record: projectSubagentDetail(record) }, { headers });
    }
    const outcome = runtime?.stopAttempt(body.agentId, body.expectedAttempt);
    if (!outcome) return NextResponse.json({ error: "This subagent attempt is no longer active" }, { status: 409, headers });
    return NextResponse.json({ record: projectSubagentDetail(outcome.record) }, { status: outcome.accepted ? 202 : 200, headers });
  } catch (error) {
    const status = error instanceof JsonBodyTooLargeError ? 413 : error instanceof TypeError || error instanceof InvalidJsonBodyError ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not stop subagent" : (error as Error).message }, { status, headers });
  }
}
