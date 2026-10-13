import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { summarizeSessionStats } from "@/lib/session-stats";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const live = getRpcSession(id);
  if (live?.isAlive()) return NextResponse.json(summarizeSessionStats(live.inner.sessionManager), { headers: { "Cache-Control": "private, no-store" } });
  const path = await resolveSessionPath(id);
  if (!path || !existsSync(path)) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json(summarizeSessionStats(SessionManager.open(path)), { headers: { "Cache-Control": "private, no-store" } });
}
