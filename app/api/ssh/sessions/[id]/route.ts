import { NextResponse } from "next/server";
import { closeSSHSession, getSSHSession } from "@/lib/ssh/session-manager";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = getSSHSession((await context.params).id);
  return session ? NextResponse.json({ snapshot: session.snapshot() }) : NextResponse.json({ error: "SSH session not found" }, { status: 404 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = (await context.params).id;
  if (!getSSHSession(id)) return NextResponse.json({ error: "SSH session not found" }, { status: 404 });
  closeSSHSession(id);
  return NextResponse.json({ ok: true });
}
