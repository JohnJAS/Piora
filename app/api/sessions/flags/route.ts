import { NextResponse } from "next/server";
import { readSessionFlags, updateSessionFlag, type SessionFlagPatch } from "@/lib/session-flags";

export async function GET() {
  try {
    return NextResponse.json({ flags: readSessionFlags() });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as SessionFlagPatch & { sessionId?: unknown };
    if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    if (typeof body.pinned !== "boolean" && typeof body.archived !== "boolean") {
      return NextResponse.json({ error: "pinned or archived is required" }, { status: 400 });
    }
    const flags = await updateSessionFlag(body.sessionId, {
      ...(typeof body.pinned === "boolean" ? { pinned: body.pinned } : {}),
      ...(typeof body.archived === "boolean" ? { archived: body.archived } : {}),
    });
    return NextResponse.json({ flag: flags[body.sessionId] });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
