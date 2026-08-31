import { after, NextResponse } from "next/server";
import {
  getSpeechStatus,
  removeSpeechPack,
  startSpeechPackInstall,
  waitForSpeechPackInstall,
} from "@/lib/speech-pack-manager";
import { resetLocalSpeechRuntime } from "@/lib/speech-runtime";
import { isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  const status = await getSpeechStatus();
  if (!status.hardware.supported) {
    return json({ error: `Local speech is not supported on ${status.hardware.platform}/${status.hardware.arch}` }, 409);
  }
  const install = startSpeechPackInstall();
  after(() => waitForSpeechPackInstall());
  return json({ install }, 202);
}

export async function DELETE(request: Request) {
  if (!isApiRequestAllowed(request)) return json({ error: "Untrusted API request" }, 403);
  try {
    resetLocalSpeechRuntime();
    return json(await removeSpeechPack());
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Unable to remove the local speech pack",
    }, 409);
  }
}
