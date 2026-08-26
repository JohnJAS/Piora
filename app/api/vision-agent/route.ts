import { NextResponse } from "next/server";

import { parseJsonWithinLimit, JsonBodyTooLargeError, InvalidJsonBodyError } from "@/lib/bounded-json";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  listVisionAgentModels,
  readVisionAgentConfig,
  writeVisionAgentConfig,
  type VisionAgentConfig,
} from "@/lib/vision-agent";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { models, error } = await listVisionAgentModels();
    return NextResponse.json({ config: readVisionAgentConfig(), models, ...(error ? { error } : {}) });
  } catch (error) {
    return NextResponse.json({
      config: readVisionAgentConfig(),
      models: [],
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

function readConfig(value: unknown): VisionAgentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidJsonBodyError();
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") throw new InvalidJsonBodyError();
  if (record.provider !== null && typeof record.provider !== "string") throw new InvalidJsonBodyError();
  if (record.modelId !== null && typeof record.modelId !== "string") throw new InvalidJsonBodyError();
  return { enabled: record.enabled, provider: record.provider, modelId: record.modelId } as VisionAgentConfig;
}

export async function PUT(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const requested = readConfig(await parseJsonWithinLimit(request, 8 * 1024));
    if (requested.enabled) {
      const { models } = await listVisionAgentModels();
      const selected = models.some((model) => (
        model.provider === requested.provider && model.modelId === requested.modelId
      ));
      if (!selected) {
        return NextResponse.json({ error: "The selected visual model is unavailable, lacks image input, or has no configured authentication." }, { status: 409 });
      }
    }
    return NextResponse.json({ config: writeVisionAgentConfig(requested) });
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError || error instanceof TypeError) {
      return NextResponse.json({ error: error instanceof TypeError ? error.message : "Invalid JSON body" }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
