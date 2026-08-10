import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds, getUnpersistedSessionInfos } from "@/lib/rpc-manager";
import { resolveProject } from "@/lib/worktree";
import { sessionPathKey } from "@/lib/session-path";
import type { SessionInfo } from "@/lib/types";

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
        const project = await resolveProject(info.cwd);
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
          projectRoot: project.projectRoot ?? info.cwd,
          ...(project.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
        };
      }),
  );
  return extras.length > 0 ? [...sessions, ...extras] : sessions;
}

export async function GET() {
  try {
    const sessions = await withUnpersistedSessions(await listAllSessions());
    return NextResponse.json({ sessions, runningSessionIds: getRunningRpcSessionIds() });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
