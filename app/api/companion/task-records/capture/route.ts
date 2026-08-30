import { basename } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import {
  readCompanionRuntimeState,
  updateCompanionRuntimeState,
} from "@/lib/companion-runtime";
import { buildCompanionTaskRecord } from "@/lib/companion-task-capture";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { buildSessionContext, resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 16 * 1024;

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await parseJsonWithinLimit(request, MAX_REQUEST_BYTES) as { sessionId?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId || sessionId.length > 120) {
      return NextResponse.json({ error: "A valid sessionId is required" }, { status: 400 });
    }
    if (!readCompanionRuntimeState().settings.autoCaptureSessions) {
      return NextResponse.json({ captured: false, reason: "disabled" });
    }

    const filePath = await resolveSessionPath(sessionId);
    if (!filePath) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const manager = SessionManager.open(filePath);
    const context = buildSessionContext(manager.getEntries() as never, manager.getLeafId(), {
      deferThinking: true,
      deferToolResultImages: true,
    });
    const header = manager.getHeader();
    const record = buildCompanionTaskRecord({
      sessionId,
      sessionTitle: manager.getSessionName() || undefined,
      project: header?.cwd ? basename(header.cwd) : undefined,
      messages: context.messages,
      entryIds: context.entryIds,
    });
    if (!record) return NextResponse.json({ captured: false, reason: "not-actionable" });

    let captured = false;
    updateCompanionRuntimeState((current) => {
      const exists = current.taskRecords.some((item) => (
        item.sessionId === record.sessionId && item.sourceEntryId === record.sourceEntryId
      ));
      if (exists) return current;
      captured = true;
      return { ...current, taskRecords: [record, ...current.taskRecords] };
    }, "task-record.captured");
    return NextResponse.json({ captured, record: captured ? record : undefined });
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
