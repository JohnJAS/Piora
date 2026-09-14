import { NextResponse } from "next/server";
import { getSSHSession } from "@/lib/ssh/session-manager";
import { isApiRequestAllowed } from "@/lib/request-security";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const session = getSSHSession((await context.params).id);
  if (!session) return NextResponse.json({ error: "SSH session not found" }, { status: 404 });
  const path = new URL(request.url).searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  try { const sftp = await session.sftp(); const data = await new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; const stream = sftp.createReadStream(path); stream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk))); stream.once("error", reject); stream.once("end", () => resolve(Buffer.concat(chunks))); }); return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${path.split(/[\\/]/).pop()?.replace(/"/g, "") || "download"}"` } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 }); }
}
