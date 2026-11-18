import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { summarizeSessionStats } from "@/lib/session-stats";
import { readSessionStatistics, SessionHistoryPageError } from "@/lib/session-read-repository";
import { isMissingSessionFileError } from "@/lib/session-detail-source";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const live = getRpcSession(id);
  if (live?.isAlive()) return NextResponse.json(summarizeSessionStats(live.inner.sessionManager), { headers: { "Cache-Control": "private, no-store" } });
  const path = await resolveSessionPath(id);
  if (!path || !existsSync(path)) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  try {
    return NextResponse.json(await readSessionStatistics(path, req.signal), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isMissingSessionFileError(error)) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ error: "Session statistics unavailable" }, { status: error instanceof SessionHistoryPageError ? error.status : 500 });
  }
}
