import { NextResponse } from "next/server";
import { parseJsonWithinLimit, InvalidJsonBodyError, JsonBodyTooLargeError } from "@/lib/bounded-json";
import { getRpcSession } from "@/lib/rpc-manager";
import { readSessionFlags } from "@/lib/session-flags";
import { createSideChatFromParent } from "@/lib/side-chat/fork";
import { readSideChatSettings } from "@/lib/side-chat/settings";
import { isValidSideChatSessionId, listSideChatsForParent } from "@/lib/side-chat/store";
import { SideChatError } from "@/lib/side-chat/types";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function collectLiveSideChatState(parentSessionId: string) {
  const runningIds = new Set<string>();
  const failedIds = new Set<string>();
  const liveNames = new Map<string, string>();
  for (const session of globalThis.__piSessions?.values() ?? []) {
    if (!session.isAlive() || session.getSideChatParentId?.() !== parentSessionId) continue;
    const name = session.inner.sessionManager.getSessionName()?.trim();
    if (name) liveNames.set(session.sessionId, name);
    const snapshot = session.getTaskRuntimeSnapshot();
    if (snapshot.runtime !== "idle" || snapshot.pendingApproval) runningIds.add(session.sessionId);
    if (snapshot.lastPromptFailed) failedIds.add(session.sessionId);
  }
  return { runningIds, failedIds, liveNames };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidSideChatSessionId(id)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400, headers });
  }
  try {
    let enabled = false;
    try {
      enabled = readSideChatSettings().enabled;
    } catch {
      enabled = false;
    }
    const query = new URL(req.url).searchParams;
    const includeArchived = query.get("includeArchived") === "true";
    const includeTemporary = query.get("includeTemporary") !== "false";
    const parentArchived = Boolean(readSessionFlags()[id]?.archived);
    const live = collectLiveSideChatState(id);
    const sideChats = listSideChatsForParent(id, {
      includeArchived,
      includeTemporary,
      ...live,
    });
    return NextResponse.json({ enabled, parentArchived, sideChats }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers },
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = req.body
      ? (await parseJsonWithinLimit(req, 8_192)) as { storage?: unknown; title?: unknown }
      : {};
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400, headers });
    }
    if (body.storage !== undefined && body.storage !== "attached" && body.storage !== "temporary") {
      return NextResponse.json({ error: "Invalid side chat storage mode" }, { status: 400, headers });
    }
    if (body.title !== undefined && typeof body.title !== "string") {
      return NextResponse.json({ error: "Title must be a string" }, { status: 400, headers });
    }
    // Keep any live parent name/model synchronized before reading entries.
    getRpcSession(id);
    const sideChat = await createSideChatFromParent({
      parentSessionId: id,
      storage: body.storage as "attached" | "temporary" | undefined,
      title: typeof body.title === "string" ? body.title.slice(0, 120) : undefined,
    });
    return NextResponse.json({ sideChat }, { status: 201, headers });
  } catch (error) {
    if (error instanceof SideChatError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
    }
    const status = error instanceof JsonBodyTooLargeError
      ? 413
      : error instanceof TypeError || error instanceof InvalidJsonBodyError
        ? 400
        : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status, headers });
  }
}
