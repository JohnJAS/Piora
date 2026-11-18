import { NextResponse } from "next/server";
import { JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { resolveSessionPath } from "@/lib/session-reader";
import { isMissingSessionFileError } from "@/lib/session-detail-source";
import { querySessionPromptReceipts, SessionHistoryPageError } from "@/lib/session-read-repository";
import { SessionControlStore } from "@/lib/session-control-store";
import { getRpcSession } from "@/lib/rpc-manager";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { ids?: unknown; anchors?: unknown; leafId?: unknown } | null;
  try { body = await parseJsonWithinLimit(request, 512 * 1024) as typeof body; }
  catch (error) {
    return NextResponse.json({ error: "Invalid prompt receipt request" }, { status: error instanceof JsonBodyTooLargeError ? 413 : 400 });
  }
  if (!Array.isArray(body?.ids) || body.ids.length > 128 || body.ids.some(value => typeof value !== "string" || !value || value.length > 512)
    || !Array.isArray(body.anchors) || body.anchors.length > 128 || body.anchors.some(value => typeof value !== "string" || !value || value.length > 128)
    || (body.leafId != null && (typeof body.leafId !== "string" || body.leafId.length > 128))) {
    return NextResponse.json({ error: "Invalid prompt receipt IDs" }, { status: 400 });
  }
  const keys = new Set<string>(body.ids);
  try {
    const path = await resolveSessionPath(id);
    const empty = { ids: [], activeAnchorIds: [] };
    const [journal, persisted] = await Promise.all([
      new SessionControlStore().queryCompletedSlashPromptIds(id, keys),
      path ? querySessionPromptReceipts(path, [...keys], [...new Set<string>(body.anchors)], body.leafId ?? undefined, request.signal).catch(error => {
        if (isMissingSessionFileError(error)) return empty;
        throw error;
      }) : empty,
    ]);
    if (!path && journal.length === 0 && !getRpcSession(id)?.isAlive()) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ persistedPromptIds: [...new Set([...persisted.ids, ...journal])], activeAnchorIds: persisted.activeAnchorIds },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SessionHistoryPageError ? error.message : "Could not confirm prompt receipts" },
      { status: error instanceof SessionHistoryPageError ? error.status : 500 });
  }
}
