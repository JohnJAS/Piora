import { NextResponse } from "next/server";
import { getSubagentRuntime } from "@/lib/subagent-runtime";
import { listSubagentRecords } from "@/lib/subagent-store";
import { buildSessionContext, getSessionEntries, resolveSessionPath } from "@/lib/session-reader";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isAbsolute, join, relative, sep } from "node:path";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    if (!await resolveSessionPath(id)) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    const runtime = getSubagentRuntime(id);
    const records = runtime?.list() ?? listSubagentRecords(id).map(record => record.status === "running"
      ? { ...record, status: "interrupted" as const, error: "Application stopped before task completion" } : record);
    const query = new URL(request.url).searchParams;
    const agentId = query.get("agentId"), toolCallId = query.get("toolCallId");
    const selected = records.filter(record => (!agentId || record.agentId === agentId) && (!toolCallId || record.parentToolCallId === toolCallId));
    let messages: unknown[] = [];
    if (query.get("transcript") === "true" && selected.length === 1 && selected[0].childSessionFile) {
      const path = selected[0].childSessionFile;
      const rel = relative(join(getAgentDir(), "piora", "subagent-sessions", id), path);
      if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Invalid child session path");
      messages = buildSessionContext(getSessionEntries(path)).messages;
    }
    return NextResponse.json({ records: selected, messages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: error instanceof TypeError ? 400 : 500 }); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await parseJsonWithinLimit(request, 1024) as { action?: unknown; agentId?: unknown };
    if (!body || body.action !== "stop" || typeof body.agentId !== "string" || Object.keys(body).some(key => !["action", "agentId"].includes(key))) throw new TypeError("Expected an owned agentId and stop action");
    const runtime = getSubagentRuntime(id);
    if (!runtime) return NextResponse.json({ error: "No live subagent runtime" }, { status: 409 });
    runtime.stop(body.agentId);
    return NextResponse.json({ record: await runtime.output(body.agentId, true) });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: error instanceof JsonBodyTooLargeError ? 413 : error instanceof TypeError || error instanceof InvalidJsonBodyError ? 400 : 409 }); }
}
