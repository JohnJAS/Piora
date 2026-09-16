import { NextResponse } from "next/server";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getAgentBrowserViewState, getBrowserViewState, performBrowserViewAction } from "@/extensions/piora-browser";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (sessionId !== null && (sessionId.length === 0 || sessionId.length > 128)) {
    return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
  }
  try {
    return NextResponse.json(sessionId === null ? await getBrowserViewState() : await getAgentBrowserViewState(sessionId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (new URL(request.url).searchParams.has("sessionId")) {
    return NextResponse.json({ error: "Agent browser view is read-only" }, { status: 400 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const input = await parseJsonWithinLimit(request, 16 * 1024) as Parameters<typeof performBrowserViewAction>[0];
    return NextResponse.json(await performBrowserViewAction(input), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    if (error instanceof InvalidJsonBodyError) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
