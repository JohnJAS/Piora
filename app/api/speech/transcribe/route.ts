import { NextResponse } from "next/server";
import { ByteBodyTooLargeError, readBytesWithinLimit } from "@/lib/bounded-bytes";
import { isApiRequestAllowed } from "@/lib/request-security";
import { getSpeechStatus } from "@/lib/speech-pack-manager";
import { SpeechUnavailableError, transcribeLocalSpeechWav } from "@/lib/speech-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const status = await getSpeechStatus();
  return NextResponse.json({
    available: status.available,
    enabled: status.enabled,
    installed: status.installed,
    engine: status.engine,
    model: status.model,
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("audio/wav")) {
    return NextResponse.json({ error: "Expected audio/wav" }, { status: 415 });
  }
  const language = new URL(request.url).searchParams.get("language") === "en" ? "en" : "zh";
  try {
    const status = await getSpeechStatus();
    if (!status.enabled) {
      return NextResponse.json({ error: "Local speech recognition is disabled" }, { status: 403 });
    }
    if (!status.installed || !status.hardware.supported) {
      return NextResponse.json({ error: "Local speech recognition is unavailable" }, { status: 503 });
    }
    const bytes = await readBytesWithinLimit(request, MAX_AUDIO_BYTES);
    const text = await transcribeLocalSpeechWav(bytes, language);
    return NextResponse.json({ text });
  } catch (error) {
    if (error instanceof ByteBodyTooLargeError) {
      return NextResponse.json({ error: "Voice recording is too large" }, { status: 413 });
    }
    if (error instanceof SpeechUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Voice transcription failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
