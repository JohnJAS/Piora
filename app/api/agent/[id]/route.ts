import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import { resolveSessionAgentRuntimeProfile } from "@/lib/agent-profile-store";

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const runtimeProfile = getAgentRuntimeProfile();
    const body = await req.json() as { type: string; [key: string]: unknown };

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      await resolveSessionAgentRuntimeProfile(id, runtimeProfile);
      if (existing.runtimeProfile !== runtimeProfile) {
        throw new Error(`Live session ${id} has a mismatched runtime profile.`);
      }
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    await resolveSessionAgentRuntimeProfile(id, runtimeProfile);

    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();

    const { session } = await startRpcSession(id, filePath, cwd, { runtimeProfile });
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const runtimeProfile = getAgentRuntimeProfile();
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      const filePath = await resolveSessionPath(id);
      if (!filePath) return NextResponse.json({ running: false, runtimeProfile });
      await resolveSessionAgentRuntimeProfile(id, runtimeProfile);
      return NextResponse.json({ running: false, runtimeProfile });
    }

    await resolveSessionAgentRuntimeProfile(id, runtimeProfile);
    if (session.runtimeProfile !== runtimeProfile) {
      throw new Error(`Live session ${id} has a mismatched runtime profile.`);
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state, runtimeProfile });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
