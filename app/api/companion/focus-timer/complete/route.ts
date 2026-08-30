import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { completeExpiredCompanionFocusTimer } from "@/lib/companion-focus-reminder";
import { readCompanionRuntimeState, writeCompanionRuntimeState } from "@/lib/companion-runtime";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
const MAX_REQUEST_BYTES = 1_024;

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });

  try {
    await parseJsonWithinLimit(request, MAX_REQUEST_BYTES);
    const current = readCompanionRuntimeState();
    const completion = completeExpiredCompanionFocusTimer(current, Date.now(), randomUUID);
    if (!completion) return NextResponse.json({ completed: false, state: current });
    const state = writeCompanionRuntimeState(completion.state, "focus-timer.completed");
    return NextResponse.json({
      completed: true,
      completedPhase: completion.completedPhase,
      reminder: Boolean(completion.decision),
      state,
    });
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    if (error instanceof InvalidJsonBodyError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
