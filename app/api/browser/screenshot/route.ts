import { NextResponse } from "next/server";
import { getBrowserViewScreenshot } from "@/extensions/piora-browser";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim() || undefined;
    const screenshot = await getBrowserViewScreenshot(sessionId);
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
