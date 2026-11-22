import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { isProjectlessChatCwd } from "@/lib/projectless-chat-path";
import { getRpcSession, stopRpcSessionsForFileMutation } from "@/lib/rpc-manager";
import { notifyDesktopAgentSessionClosed } from "@/lib/desktop-browser-agent";
import { acquireSessionMutation } from "@/lib/session-mutation";
import { cacheSessionPath, invalidateSessionListCache, invalidateSessionPathCache } from "@/lib/session-reader";
import { resolveProject } from "@/lib/worktree";
import {
  deleteSideChatFile,
  invalidateSideChatCache,
  isValidSideChatSessionId,
  promoteSideChatToStandaloneSession,
  readSideChatMetaFromEntries,
  readSideChatSummaryByPath,
  resolveSideChatPath,
  setSideChatArchived,
} from "@/lib/side-chat/store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function resolveOwnedSideChat(parentId: string, sideId: string): { filePath: string } | NextResponse {
  if (!isValidSideChatSessionId(parentId) || !isValidSideChatSessionId(sideId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400, headers });
  }
  const filePath = resolveSideChatPath(sideId);
  if (!filePath || !existsSync(filePath)) {
    return NextResponse.json({ error: "Side chat not found" }, { status: 404, headers });
  }
  const sm = SessionManager.open(filePath, dirname(filePath));
  const meta = readSideChatMetaFromEntries(sm.getEntries());
  if (!meta || meta.parentSessionId !== parentId) {
    return NextResponse.json({ error: "Side chat does not belong to this conversation" }, { status: 403, headers });
  }
  return { filePath };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; sideId: string }> },
) {
  const { id, sideId } = await params;
  try {
    const owned = resolveOwnedSideChat(id, sideId);
    if (owned instanceof NextResponse) return owned;

    const body = await parseJsonWithinLimit(req, 8_192) as {
      name?: unknown;
      archived?: unknown;
      action?: unknown;
    };
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400, headers });
    }

    if (body.action === "promote") {
      const prePromotionSummary = readSideChatSummaryByPath(owned.filePath);
      const promoted = await promoteSideChatToStandaloneSession(sideId);
      cacheSessionPath(promoted.sessionId, promoted.filePath);
      invalidateSessionListCache();
      const projectless = isProjectlessChatCwd(promoted.cwd);
      const project = projectless ? null : await resolveProject(promoted.cwd);
      const now = new Date().toISOString();
      return NextResponse.json({
        promotedSession: {
          path: promoted.filePath,
          id: promoted.sessionId,
          cwd: promoted.cwd,
          name: promoted.name,
          created: now,
          modified: now,
          messageCount: prePromotionSummary?.messageCount ?? 0,
          firstMessage: prePromotionSummary?.preview ?? "",
          ...(projectless ? { projectless: true } : { projectRoot: project?.projectRoot ?? promoted.cwd }),
          ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
        },
      }, { headers });
    }

    if (typeof body.name === "string") {
      const trimmed = body.name.trim();
      if (!trimmed) {
        return NextResponse.json({ error: "Name cannot be empty" }, { status: 400, headers });
      }
      const live = getRpcSession(sideId);
      if (live?.isAlive()) live.setSessionName(trimmed);
      else SessionManager.open(owned.filePath, dirname(owned.filePath)).appendSessionInfo(trimmed);
    }

    if (typeof body.archived === "boolean") {
      if (body.archived) {
        await stopRpcSessionsForFileMutation([sideId]);
      }
      setSideChatArchived(sideId, body.archived);
    }

    const live = getRpcSession(sideId);
    const runningIds = new Set<string>();
    const failedIds = new Set<string>();
    const liveNames = new Map<string, string>();
    if (live?.isAlive()) {
      const liveName = live.inner.sessionManager.getSessionName()?.trim();
      if (liveName) liveNames.set(sideId, liveName);
      const snapshot = live.getTaskRuntimeSnapshot();
      if (snapshot.runtime !== "idle" || snapshot.pendingApproval) runningIds.add(sideId);
      if (snapshot.lastPromptFailed) failedIds.add(sideId);
    }
    const summary = readSideChatSummaryByPath(owned.filePath, { runningIds, failedIds, liveNames });
    return NextResponse.json({ sideChat: summary }, { headers });
  } catch (error) {
    const status = error instanceof JsonBodyTooLargeError
      ? 413
      : error instanceof TypeError || error instanceof InvalidJsonBodyError
        ? 400
        : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status, headers });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; sideId: string }> },
) {
  const { id, sideId } = await params;
  try {
    const owned = resolveOwnedSideChat(id, sideId);
    if (owned instanceof NextResponse) return owned;

    const release = acquireSessionMutation([sideId]);
    try {
      await stopRpcSessionsForFileMutation([sideId]);
      deleteSideChatFile(sideId);
      invalidateSessionPathCache(sideId);
      invalidateSideChatCache(sideId);
      notifyDesktopAgentSessionClosed(sideId);
      return NextResponse.json({ ok: true }, { headers });
    } finally {
      release();
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers },
    );
  }
}
