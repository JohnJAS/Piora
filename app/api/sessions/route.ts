import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds, getUnpersistedSessionInfos } from "@/lib/rpc-manager";
import { resolveProject } from "@/lib/worktree";
import { sessionPathKey } from "@/lib/session-path";
import type { SessionInfo } from "@/lib/types";
import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import {
  isSessionVisibleInAgentRuntimeProfile,
  readAgentProfileStore,
} from "@/lib/agent-profile-store";
import { isProjectlessChatCwd } from "@/lib/projectless-chat-path";
import { listRooms } from "@/lib/room-store";
import { getManagedRoomSessionIds } from "@/lib/room-session-visibility";

const SIDEBAR_PAGE_SIZE = 400;

function preview(session: SessionInfo): SessionInfo {
  return { ...session, firstMessage: session.firstMessage.slice(0, 240) };
}

// pi only writes a session file once an assistant message exists, so a
// brand-new session is missing from the disk scan until its first turn
// completes. Merge live-but-unflushed sessions from the RPC registry so the
// sidebar shows them immediately; disk entries win once the file lands.
async function withUnpersistedSessions(sessions: SessionInfo[]): Promise<SessionInfo[]> {
  const knownIds = new Set(sessions.map((s) => s.id));
  const unpersisted = getUnpersistedSessionInfos(knownIds);
  if (unpersisted.length === 0) return sessions;

  const pathToId = new Map(sessions.map((s) => [sessionPathKey(s.path), s.id]));
  const extras = await Promise.all(
    unpersisted
      .map(async (info): Promise<SessionInfo> => {
        const projectless = isProjectlessChatCwd(info.cwd);
        const project = projectless ? null : await resolveProject(info.cwd);
        return {
          path: info.path,
          id: info.id,
          cwd: info.cwd,
          name: info.name,
          created: info.created,
          modified: info.modified,
          messageCount: info.messageCount,
          firstMessage: info.firstMessage,
          parentSessionId: info.parentSessionPath
            ? pathToId.get(sessionPathKey(info.parentSessionPath))
            : undefined,
          ...(!projectless ? { projectRoot: project?.projectRoot ?? info.cwd } : {}),
          ...(projectless ? { projectless: true } : {}),
          ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
        };
      }),
  );
  return extras.length > 0 ? [...sessions, ...extras] : sessions;
}

export async function GET(request: Request) {
  try {
    const runtimeProfile = getAgentRuntimeProfile();
    const profileStore = readAgentProfileStore();
    const allSessions = await withUnpersistedSessions(await listAllSessions());
    const roomSessions = getManagedRoomSessionIds(listRooms());
    const sessions = allSessions.filter((session) =>
      !roomSessions.has(session.id) && isSessionVisibleInAgentRuntimeProfile(session.id, runtimeProfile, profileStore)
    );
    const visibleIds = new Set(sessions.map((session) => session.id));
    const runningSessionIds = getRunningRpcSessionIds().filter((id) => visibleIds.has(id));
    const query = new URL(request.url).searchParams;
    if (query.get("view") === "metadata") {
      const ids = new Set(query.getAll("sessionId"));
      if (ids.size > 128) return NextResponse.json({ error: "Too many session IDs" }, { status: 400 });
      const requested = ids.size ? sessions.filter(session => ids.has(session.id)) : sessions;
      const result = query.has("presence") ? requested.slice(0, 1) : requested;
      return NextResponse.json({ sessions: result.map(preview), runtimeProfile });
    }
    if (query.get("view") === "sidebar") {
      const requested = Number(query.get("offset") ?? "0");
      const offset = Number.isSafeInteger(requested) && requested >= 0 ? requested : 0;
      const version = createHash("sha256").update(JSON.stringify([...visibleIds])).digest("base64url");
      if (query.has("version") && query.get("version") !== version) {
        return NextResponse.json({ error: "The session list changed" }, { status: 409 });
      }
      const next = offset + SIDEBAR_PAGE_SIZE;
      return NextResponse.json({ sessions: sessions.slice(offset, next).map(preview), runningSessionIds, runtimeProfile,
        version, nextOffset: next < sessions.length ? next : null });
    }
    return NextResponse.json({ sessions, runningSessionIds, runtimeProfile });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
