import { NextResponse } from "next/server";
import { getSSHSession } from "@/lib/ssh/session-manager";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-json";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  const session = getSSHSession((await context.params).id);
  if (!session) return NextResponse.json({ error: "SSH session not found" }, { status: 404 });
  const body = await parseJsonWithinLimit(request, 256 * 1024) as { action?: string; data?: string; cols?: number; rows?: number };
  if (body.action === "start") { await session.connect(); return NextResponse.json({ snapshot: session.snapshot() }); }
  if (body.action === "resize") { session.resize(body.cols ?? 100, body.rows ?? 30); return NextResponse.json({ ok: true }); }
  if (body.action === "input" && typeof body.data === "string") { session.write(body.data); return NextResponse.json({ ok: true }); }
  if (body.action === "exec" && typeof body.data === "string") { const result = await session.exec(body.data); return NextResponse.json(result); }
  if (body.action === "close") { session.close(); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "Unsupported SSH action" }, { status: 400 });
}
