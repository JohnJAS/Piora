import { after, NextResponse } from "next/server";
import {
  getManualSpeechPackState,
  startManualSpeechPackInstall,
  storeManualSpeechPackSource,
  waitForSpeechPackInstall,
} from "@/lib/speech-pack-manager";
import { isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  return json(await getManualSpeechPackState());
}

export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  const name = new URL(request.url).searchParams.get("name") ?? "";
  const contentLength = request.headers.get("content-length");
  try {
    const manual = await storeManualSpeechPackSource(
      name,
      request.body,
      contentLength ? Number(contentLength) : undefined,
    );
    if (!manual.complete) return json({ manual, install: null }, 202);
    const install = startManualSpeechPackInstall();
    after(() => waitForSpeechPackInstall());
    return json({ manual, install }, 202);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to import speech-pack file" }, 400);
  }
}
