import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  cacheSessionPath,
  invalidateSessionListCache,
  resolveSessionPath,
} from "@/lib/session-reader";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const source = SessionManager.open(filePath);
    const leafId = source.getLeafId();
    if (!leafId) return NextResponse.json({ error: "Session is empty" }, { status: 409 });
    const duplicatedPath = source.createBranchedSession(leafId);
    if (!duplicatedPath) return NextResponse.json({ error: "Failed to duplicate session" }, { status: 500 });
    const duplicate = SessionManager.open(duplicatedPath);
    const newSessionId = duplicate.getSessionId();
    const originalName = source.getSessionName();
    if (originalName) duplicate.appendSessionInfo(`${originalName} copy`);
    cacheSessionPath(newSessionId, duplicatedPath);
    invalidateSessionListCache();
    return NextResponse.json({ sessionId: newSessionId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
