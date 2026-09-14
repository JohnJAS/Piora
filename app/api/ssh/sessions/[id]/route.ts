import { NextResponse } from "next/server";
import { closeSSHSession, getSSHSession } from "@/lib/ssh/session-manager";
import { isApiRequestAllowed } from "@/lib/request-security";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(_request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const session = getSSHSession((await context.params).id);
  return session ? NextResponse.json({ snapshot: session.snapshot() }) : NextResponse.json({ error: "SSH session not found" }, { status: 404 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(_request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const id = (await context.params).id;
  if (!getSSHSession(id)) return NextResponse.json({ error: "SSH session not found" }, { status: 404 });
  closeSSHSession(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const session = getSSHSession((await context.params).id);
  if (!session) return NextResponse.json({ error: "SSH session not found" }, { status: 404 });
  const body = await request.json() as { mode?: string; agentSessionId?: string };
  if (body.mode === "agent-controlled" && body.agentSessionId) session.bindAgent(body.agentSessionId);
  else if (body.mode === "independent") session.unbindAgent();
  else return NextResponse.json({ error: "mode and agentSessionId are required" }, { status: 400 });
  return NextResponse.json({ snapshot: session.snapshot() });
}
