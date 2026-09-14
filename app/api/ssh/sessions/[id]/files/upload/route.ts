import { NextResponse } from "next/server";
import { getSSHSession } from "@/lib/ssh/session-manager";
import { isApiRequestAllowed } from "@/lib/request-security";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const session = getSSHSession((await context.params).id);
  if (!session) return NextResponse.json({ error: "SSH session not found" }, { status: 404 });
  const path = new URL(request.url).searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 100 * 1024 * 1024) return NextResponse.json({ error: "File exceeds the 100 MB upload limit" }, { status: 413 });
  try { const sftp = await session.sftp(); const data = Buffer.from(await request.arrayBuffer()); await new Promise<void>((resolve, reject) => { const stream = sftp.createWriteStream(path, { flags: "w", mode: 0o644 }); stream.once("error", reject); stream.once("close", resolve); stream.end(data); }); return NextResponse.json({ ok: true, path, bytes: data.byteLength }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 }); }
}
