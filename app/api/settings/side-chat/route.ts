import { NextResponse } from "next/server";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { readSideChatSettings, writeSideChatSettings } from "@/lib/side-chat/settings";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    return NextResponse.json(readSideChatSettings(), { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers },
    );
  }
}

export async function PUT(request: Request) {
  try {
    return NextResponse.json(writeSideChatSettings(await parseJsonWithinLimit(request, 1_024)), { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      {
        status: error instanceof JsonBodyTooLargeError
          ? 413
          : error instanceof TypeError || error instanceof InvalidJsonBodyError
            ? 400
            : 500,
        headers,
      },
    );
  }
}
