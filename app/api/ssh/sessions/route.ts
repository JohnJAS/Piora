import { NextResponse } from "next/server";
import { createSSHSession, listSSHSessions } from "@/lib/ssh/session-manager";
import type { SSHConnectionOptions } from "@/lib/ssh/types";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-json";

export async function POST(request: Request) {
  try {
    if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
    if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    const body = await parseJsonWithinLimit(request, 2 * 1024 * 1024) as Partial<SSHConnectionOptions>;
    if (!body.host || !body.username || !body.auth || (body.auth.type !== "password" && body.auth.type !== "privateKey")) {
      return NextResponse.json({ error: "host, username and password/privateKey auth are required" }, { status: 400 });
    }
    const session = createSSHSession({ host: body.host, username: body.username, port: body.port, auth: body.auth, cols: body.cols, rows: body.rows });
    await session.connect();
    return NextResponse.json({ snapshot: session.snapshot() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  return NextResponse.json({ sessions: listSSHSessions() }, { headers: { "Cache-Control": "no-store" } });
}
