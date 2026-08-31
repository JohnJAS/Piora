import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveOrStartRpcSession } from "@/lib/session-runtime-resolver";
import { resolveSessionPath } from "@/lib/session-reader";
import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import { resolveSessionAgentRuntimeProfile } from "@/lib/agent-profile-store";
import { getSessionMessageRouter, SessionMessageRouterError } from "@/lib/session-message-router";
import { randomUUID } from "node:crypto";

function messageIdempotency(id: string, body: Record<string, unknown>): string {
  return typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim()
    : `ui:${id}:${randomUUID()}`;
}

function errorStatus(error: unknown): number {
  if (error instanceof SessionMessageRouterError) {
    if (["SESSION_NOT_FOUND", "SESSION_FILE_INVALID"].includes(error.code)) return 404;
    if (["SESSION_BUSY", "STEER_REQUIRES_RUNNING_SESSION", "SESSION_QUEUE_FULL"].includes(error.code)) return 409;
    if (error.code === "SESSION_MESSAGE_TOO_LARGE") return 413;
    if (["INVALID_SESSION_MESSAGE", "COMMAND_EXPIRED"].includes(error.code)) return 400;
  }
  return 500;
}

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const runtimeProfile = getAgentRuntimeProfile();
    const body = await req.json() as { type: string; [key: string]: unknown };

    if (body.type === "prompt" || body.type === "steer" || body.type === "follow_up") {
      const router = getSessionMessageRouter();
      const input = {
        targetSessionId: id,
        content: typeof body.message === "string" ? body.message : "",
        source: "ui" as const,
        idempotencyKey: messageIdempotency(id, body),
        ...(Array.isArray(body.images) ? { images: body.images } : {}),
        ...(Array.isArray(body.materials) ? { materials: body.materials as Array<{ id: string }> } : {}),
      };
      const result = body.type === "steer"
        ? await router.steerSession(input)
        : body.type === "follow_up" || body.streamingBehavior === "followUp"
          ? await router.followUpSession(input)
          : body.streamingBehavior === "steer"
            ? await router.steerSession(input)
            : await router.dispatchSessionMessage({ ...input, delivery: "next_turn" });
      return NextResponse.json({ success: true, data: result, commandId: result.commandId, ...(result.runId ? { runId: result.runId } : {}), ...(result.attachedRunId ? { attachedRunId: result.attachedRunId } : {}) });
    }

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

    const { session } = await resolveOrStartRpcSession(id, { runtimeProfile });
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), ...(error instanceof SessionMessageRouterError ? { code: error.code } : {}) }, { status: errorStatus(error) });
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
