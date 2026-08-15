import { NextResponse } from "next/server";
import { addRoomMember, createRoom, getRoom, listRooms } from "@/lib/room-store";
import type { RoomMemberRole } from "@/lib/room-types";
import { resolveProject } from "@/lib/worktree";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const sessionId = new URL(request.url).searchParams.get("sessionId") ?? undefined;
    return NextResponse.json({ rooms: listRooms(sessionId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      name?: string;
      description?: string;
      projectRoot?: string;
      sessionId?: string;
      sessionName?: string;
      cwd?: string;
      role?: RoomMemberRole;
      members?: Array<{
        sessionId: string;
        sessionName?: string;
        cwd?: string;
        projectRoot?: string;
        role?: RoomMemberRole;
        instructions?: string;
      }>;
    };
    if (!body.name || !body.sessionId) {
      return NextResponse.json({ error: "name and sessionId are required" }, { status: 400 });
    }
    const project = body.cwd ? await resolveProject(body.cwd) : undefined;
    const room = createRoom({
      name: body.name,
      description: body.description,
      projectRoot: project?.projectRoot ?? body.projectRoot,
      creator: {
        sessionId: body.sessionId,
        name: body.sessionName,
        cwd: body.cwd,
        projectRoot: project?.projectRoot ?? body.projectRoot,
        worktreeBranch: project?.isWorktree ? project.branch ?? undefined : undefined,
        role: body.role ?? "coordinator",
        instructions: "Coordinate the team, clarify decisions, and keep shared work aligned.",
      },
    });
    for (const member of body.members ?? []) {
      if (!member.sessionId || member.sessionId === body.sessionId) continue;
      const memberProject = member.cwd ? await resolveProject(member.cwd) : undefined;
      addRoomMember(room.id, {
        sessionId: member.sessionId,
        name: member.sessionName,
        cwd: member.cwd,
        projectRoot: memberProject?.projectRoot ?? member.projectRoot,
        worktreeBranch: memberProject?.isWorktree ? memberProject.branch ?? undefined : undefined,
        role: member.role ?? "participant",
        instructions: member.instructions,
      });
    }
    return NextResponse.json({ room: getRoom(room.id) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
