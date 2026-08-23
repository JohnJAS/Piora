import { randomUUID } from "node:crypto";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { createTeamAgentProfile, validateTeamAgentProfile } from "@/lib/team-agent-templates";
import { requireRoomCoordinatorBySession, requireRoomMemberBySession } from "@/lib/team-agent-api";
import { provisionTeamAgentSession, rollbackProvisionedTeamAgentSession } from "@/lib/team-agent-provisioner";
import { teamApiError } from "@/lib/team-api";
import { addRoomMember, removeRoomMember, updateRoomAgentBinding, updateRoomAgentProfile } from "@/lib/room-store";
import type { CollaborationRoomV3, TeamAgentBinding, TeamAgentProfile, TeamAgentRole } from "@/lib/team-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { room } = requireRoomMemberBySession(id, new URL(request.url).searchParams.get("sessionId"));
    return Response.json({ agents: room.members });
  } catch (error) { return teamApiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let provisioned: { room: CollaborationRoomV3; binding: TeamAgentBinding; requesterSessionId: string; memberAdded: boolean } | undefined;
  try {
    const { id } = await params;
    const body = await parseJsonWithinLimit(request, 256 * 1024) as { sessionId?: unknown; role?: unknown; name?: unknown; roleDescription?: unknown; profile?: unknown };
    const { room, member: requester } = requireRoomCoordinatorBySession(id, body.sessionId);
    const role = typeof body.role === "string" ? body.role as TeamAgentRole : "worker";
    const profile = body.profile
      ? validateTeamAgentProfile({ ...body.profile as TeamAgentProfile, role })
      : createTeamAgentProfile(role, {
        name: typeof body.name === "string" && body.name.trim() ? body.name : `${role} Agent`,
        roleDescription: typeof body.roleDescription === "string" ? body.roleDescription : undefined,
      });
    const memberId = randomUUID();
    const binding = await provisionTeamAgentSession(room, profile, memberId);
    provisioned = { room, binding, requesterSessionId: requester.binding.sessionId, memberAdded: false };
    addRoomMember(id, {
      memberId,
      sessionId: binding.sessionId,
      name: profile.name,
      instructions: profile.roleDescription,
      role: profile.role,
      cwd: binding.cwd,
      projectRoot: binding.projectRoot,
      worktreeBranch: binding.worktreeBranch,
      requestedBy: requester.binding.sessionId,
    });
    provisioned.memberAdded = true;
    const patch = structuredClone(profile) as Partial<TeamAgentProfile> & { schemaVersion?: unknown; revision?: unknown };
    delete patch.schemaVersion;
    delete patch.revision;
    updateRoomAgentProfile(id, requester.binding.sessionId, memberId, 1, patch);
    const saved = updateRoomAgentBinding(id, requester.binding.sessionId, memberId, binding);
    provisioned = undefined;
    return Response.json({ room: saved, agent: saved.members.find((candidate) => candidate.memberId === memberId) }, { status: 201 });
  } catch (error) {
    if (provisioned) {
      if (provisioned.memberAdded) {
        try { removeRoomMember(provisioned.room.id, provisioned.binding.sessionId, provisioned.requesterSessionId); } catch { /* Preserve the original provisioning error. */ }
      }
      await rollbackProvisionedTeamAgentSession(provisioned.room, provisioned.binding);
    }
    return teamApiError(error);
  }
}
