import { NextResponse } from "next/server";

import { invalidateServicesCache, reloadAllNormalSessionSystemPrompts } from "@/lib/rpc-manager";
import {
  readSystemPromptConfig,
  SYSTEM_PROMPT_MAX_LENGTH,
  writeSystemPromptConfig,
} from "@/lib/system-prompt-config";

export async function GET() {
  const config = readSystemPromptConfig();
  return NextResponse.json({ prompt: config.prompt, updatedAt: config.updatedAt, maxLength: SYSTEM_PROMPT_MAX_LENGTH });
}
export async function PUT(request: Request) {
  try {
    const body = await request.json() as { prompt?: unknown };
    if (body.prompt !== null && typeof body.prompt !== "string") {
      return NextResponse.json({ error: "System prompt must be a string or null." }, { status: 400 });
    }
    const prompt = body.prompt as string | null;
    const config = writeSystemPromptConfig(prompt);
    invalidateServicesCache();
    const refresh = await reloadAllNormalSessionSystemPrompts();
    return NextResponse.json({
      prompt: config.prompt,
      updatedAt: config.updatedAt,
      maxLength: SYSTEM_PROMPT_MAX_LENGTH,
      ...refresh,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
