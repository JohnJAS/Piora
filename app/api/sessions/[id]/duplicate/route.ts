import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  cacheSessionPath,
  invalidateSessionListCache,
  resolveSessionPath,
} from "@/lib/session-reader";
import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import {
  bindSessionAgentRuntimeProfile,
  quarantineUnboundSessionFile,
  resolveSessionAgentRuntimeProfile,
} from "@/lib/agent-profile-store";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const runtimeProfile = getAgentRuntimeProfile();
    const filePath = await resolveSessionPath(id);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    await resolveSessionAgentRuntimeProfile(id, runtimeProfile);
    const source = SessionManager.open(filePath);
    const leafId = source.getLeafId();
    if (!leafId) return NextResponse.json({ error: "Session is empty" }, { status: 409 });
    const duplicatedPath = source.createBranchedSession(leafId);
    if (!duplicatedPath) return NextResponse.json({ error: "Failed to duplicate session" }, { status: 500 });
    const duplicate = SessionManager.open(duplicatedPath);
    const newSessionId = duplicate.getSessionId();
    try {
      await bindSessionAgentRuntimeProfile(newSessionId, runtimeProfile);
    } catch (profileError) {
      quarantineUnboundSessionFile(duplicatedPath);
      throw profileError;
    }
    const originalName = source.getSessionName();
    if (originalName) duplicate.appendSessionInfo(`${originalName} copy`);
    cacheSessionPath(newSessionId, duplicatedPath);
    invalidateSessionListCache();
    return NextResponse.json({ sessionId: newSessionId, runtimeProfile });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
