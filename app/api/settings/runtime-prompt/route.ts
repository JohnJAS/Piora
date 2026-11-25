import { NextResponse } from "next/server";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { readRuntimePromptSettings, writeRuntimePromptSettings } from "@/lib/prompt-runtime/settings";
import {
  invalidateServicesCache,
  reloadAllNormalSessionSystemPrompts,
  reloadLiveCompactionSettings,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    return NextResponse.json(readRuntimePromptSettings(), { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await parseJsonWithinLimit(request, 8_192);
    const settings = writeRuntimePromptSettings(body);
    invalidateServicesCache();
    const refresh = await reloadAllNormalSessionSystemPrompts();
    await reloadLiveCompactionSettings();
    return NextResponse.json({ ...settings, ...refresh }, { headers });
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
