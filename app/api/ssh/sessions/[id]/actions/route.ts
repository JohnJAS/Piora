import { NextResponse } from "next/server";
import { getSSHSession } from "@/lib/ssh/session-manager";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = getSSHSession((await context.params).id);
  if (!session) return NextResponse.json({ error: "SSH session not found" }, { status: 404 });
  const body = await request.json() as { action?: string; data?: string };
  if (body.action === "input" && typeof body.data === "string") { session.write(body.data); return NextResponse.json({ ok: true }); }
  if (body.action === "exec" && typeof body.data === "string") { const result = await session.exec(body.data); return NextResponse.json(result); }
  if (body.action === "close") { session.close(); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "Unsupported SSH action" }, { status: 400 });
}
