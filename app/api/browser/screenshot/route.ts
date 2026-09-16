import { NextResponse } from "next/server";
import { getAgentBrowserViewScreenshot, getBrowserViewScreenshot } from "@/extensions/piora-browser";
import { isApiRequestAllowed } from "@/lib/request-security";

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
    const screenshot = sessionId === null ? await getBrowserViewScreenshot() : await getAgentBrowserViewScreenshot(sessionId);
    if (!screenshot) return NextResponse.json({ error: "Agent browser is not open" }, { status: 404 });
    return new NextResponse(new Blob([new Uint8Array(screenshot)], { type: "image/png" }), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
