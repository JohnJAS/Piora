import { NextResponse } from "next/server";
import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import { isSessionVisibleInAgentRuntimeProfile, readAgentProfileStore } from "@/lib/agent-profile-store";
import { searchConversationSessions } from "@/lib/conversation-search";
import { readSessionFlags } from "@/lib/session-flags";
import { listAllSessions } from "@/lib/session-reader";
import { filterFileEntries } from "@/lib/file-fuzzy";
import { matchesConversationFilter } from "@/lib/conversation-search-filter";
import { listRooms } from "@/lib/room-store";
import { getManagedRoomSessionIds } from "@/lib/room-session-visibility";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const runtimeProfile = getAgentRuntimeProfile();
    const profileStore = readAgentProfileStore();
    const sessions = (await listAllSessions()).filter((session) => (
      isSessionVisibleInAgentRuntimeProfile(session.id, runtimeProfile, profileStore)
    ));
    const flags = readSessionFlags();
    const query = (params.get("q") ?? "").trim().slice(0, 200);
    const archive: "active" | "archived" | "all" = params.get("archive") === "active" ? "active" : params.get("archive") === "archived" ? "archived" : "all";
    const project = params.get("project");
    const response = await searchConversationSessions(sessions, flags, {
      query,
      project,
      archive,
      limit: Number(params.get("limit") ?? 50),
    }, request.signal);
    if (query && params.get("titles") === "1") {
      const roomSessions = getManagedRoomSessionIds(listRooms());
      const choices = sessions.filter(session => !roomSessions.has(session.id) && matchesConversationFilter(session, flags, archive, project))
        .map(session => ({ path: (session.name?.trim() || session.firstMessage) + " " + session.firstMessage, isDir: false, session }));
      response.sessionMatches = filterFileEntries(choices, query, 8).map(item => {
        const session = (item as typeof choices[number]).session;
        return { ...session, firstMessage: session.firstMessage.slice(0, 240) };
      });
    }
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
