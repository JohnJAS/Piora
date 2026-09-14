import { NextResponse } from "next/server";
import { createSSHSession } from "@/lib/ssh/session-manager";
import type { SSHConnectionOptions } from "@/lib/ssh/types";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<SSHConnectionOptions>;
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
