import { NextResponse } from "next/server";
import { getSSHSession } from "@/lib/ssh/session-manager";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = getSSHSession((await context.params).id);
  if (!session) return NextResponse.json({ error: "SSH session not found" }, { status: 404 });
  const path = new URL(request.url).searchParams.get("path") || ".";
  try {
    const sftp = await session.sftp();
    const entries = await new Promise<Array<{ name: string; path: string; type: "file" | "directory" | "other"; size: number; modifiedAt: number | null }>>((resolve, reject) => {
      sftp.readdir(path, (error, list) => {
        if (error) return reject(error);
        resolve(list.map(item => ({ name: item.filename, path: `${path.replace(/\/$/, "")}/${item.filename}`, type: item.attrs.isDirectory() ? "directory" : item.attrs.isFile() ? "file" : "other", size: item.attrs.size ?? 0, modifiedAt: item.attrs.mtime ? item.attrs.mtime * 1000 : null })));
      });
    });
    return NextResponse.json({ path, entries });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 }); }
}
