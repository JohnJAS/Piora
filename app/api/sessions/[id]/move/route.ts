import { NextResponse } from "next/server";
import { moveSessionTreeToCwd, SessionMoveError } from "@/lib/session-move";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await request.json() as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const result = await moveSessionTreeToCwd(id, cwd);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof SessionMoveError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
