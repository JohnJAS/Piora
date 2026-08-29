import { NextResponse } from "next/server";

import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import { resolveOrStartRpcSession } from "@/lib/session-runtime-resolver";
import type { SessionCapabilityPreset } from "@/lib/session-capabilities";

const PRESETS: readonly SessionCapabilityPreset[] = ["chat", "coding", "research", "device", "custom"];

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) return 404;
  if (/busy|another view|revision/i.test(message)) return 409;
  return 400;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { session } = await resolveOrStartRpcSession(id, { runtimeProfile: getAgentRuntimeProfile() });
    const capabilities = await session.send({ type: "get_capabilities" });
    return NextResponse.json(capabilities);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: errorStatus(error) });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await request.json() as {
      preset?: unknown;
      enabledCapabilityIds?: unknown;
      expectedRevision?: unknown;
    };
    if (typeof body.preset !== "string" || !PRESETS.includes(body.preset as SessionCapabilityPreset)) {
      throw new Error("Invalid session tool preset.");
    }
    if (body.enabledCapabilityIds !== undefined && !Array.isArray(body.enabledCapabilityIds)) {
      throw new Error("Invalid enabled session tools.");
    }
    if (body.expectedRevision !== undefined && (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0)) {
      throw new Error("Invalid session tool revision.");
    }
    const { session } = await resolveOrStartRpcSession(id, { runtimeProfile: getAgentRuntimeProfile() });
    const capabilities = await session.send({
      type: "set_capabilities",
      preset: body.preset,
      ...(Array.isArray(body.enabledCapabilityIds)
        ? { enabledCapabilityIds: body.enabledCapabilityIds.filter((value): value is string => typeof value === "string") }
        : {}),
      ...(body.expectedRevision !== undefined ? { expectedRevision: Number(body.expectedRevision) } : {}),
    });
    return NextResponse.json(capabilities);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: errorStatus(error) });
  }
}
