import { NextResponse } from "next/server";
import { closeSSHSession, getSSHSession } from "@/lib/ssh/session-manager";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { changeSSHBinding, SSHBindingError } from "@/lib/ssh/binding";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(_request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const session = getSSHSession((await context.params).id);
  return session ? NextResponse.json({ snapshot: session.snapshot() }) : NextResponse.json({ error: "SSH session not found" }, { status: 404 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(_request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const id = (await context.params).id;
  const session = getSSHSession(id);
  if (!session) return NextResponse.json({ error: "SSH session not found" }, { status: 404 });
  try { if (session.agentSessionId) await changeSSHBinding(session); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: error instanceof SSHBindingError ? error.code : "connection" }, { status: 409 }); }
  closeSSHSession(id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  const session = getSSHSession((await context.params).id);
  if (!session) return NextResponse.json({ error: "SSH session not found" }, { status: 404 });
  try {
    const body = await parseJsonWithinLimit(request, 4096) as { mode?: string; agentSessionId?: string };
    if (body.mode === "agent-controlled" && typeof body.agentSessionId === "string" && body.agentSessionId.trim()) await changeSSHBinding(session, body.agentSessionId.trim());
    else if (body.mode === "independent") await changeSSHBinding(session);
    else return NextResponse.json({ error: "mode and agentSessionId are required" }, { status: 400 });
    return NextResponse.json({ snapshot: session.snapshot() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: error instanceof SSHBindingError ? error.code : "connection" }, { status: error instanceof SSHBindingError ? 409 : 400 });
  }
}
