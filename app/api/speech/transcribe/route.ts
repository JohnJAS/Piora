import { NextResponse } from "next/server";
import { ByteBodyTooLargeError, readBytesWithinLimit } from "@/lib/bounded-bytes";
import { isApiRequestAllowed } from "@/lib/request-security";
import {
  isWhisperAvailable,
  transcribeWhisperWav,
  WhisperBusyError,
  WhisperUnavailableError,
} from "@/lib/whisper-transcription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  return NextResponse.json({ available: isWhisperAvailable(), engine: "whisper.cpp", model: "base-q5_1" });
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
    const bytes = await readBytesWithinLimit(request, MAX_AUDIO_BYTES);
    const text = await transcribeWhisperWav(bytes, language);
    return NextResponse.json({ text });
  } catch (error) {
    if (error instanceof ByteBodyTooLargeError) {
      return NextResponse.json({ error: "Voice recording is too large" }, { status: 413 });
    }
    if (error instanceof WhisperBusyError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof WhisperUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Voice transcription failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
