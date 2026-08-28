import { NextResponse } from "next/server";

import { parseJsonWithinLimit, JsonBodyTooLargeError, InvalidJsonBodyError } from "@/lib/bounded-json";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  analyzeImagesWithVisionModel,
  listVisionAgentModels,
  readVisionAgentConfig,
  writeVisionAgentConfig,
  type VisionAgentConfig,
} from "@/lib/vision-agent";
import { ModelRequestCwdError, resolveModelRequestCwd } from "@/lib/model-runtime-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const cwd = await resolveModelRequestCwd(new URL(request.url).searchParams.get("cwd"));
    const { models, error } = await listVisionAgentModels(cwd);
    return NextResponse.json({ config: readVisionAgentConfig(), models, ...(error ? { error } : {}) });
  } catch (error) {
    return NextResponse.json({
      config: readVisionAgentConfig(),
      models: [],
      error: error instanceof Error ? error.message : String(error),
    }, { status: error instanceof ModelRequestCwdError ? error.status : 500 });
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
    const body = await parseJsonWithinLimit(request, 8 * 1024) as Record<string, unknown>;
    const requested = readConfig(body);
    const cwd = await resolveModelRequestCwd(typeof body.cwd === "string" ? body.cwd : undefined);
    if (requested.enabled) {
      const { models } = await listVisionAgentModels(cwd);
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
    if (error instanceof ModelRequestCwdError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof InvalidJsonBodyError || error instanceof TypeError) {
      return NextResponse.json({ error: error instanceof TypeError ? error.message : "Invalid JSON body" }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

const TEST_IMAGE = {
  type: "image" as const,
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=",
};

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ ok: false, error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ ok: false, error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await parseJsonWithinLimit(request, 8 * 1024) as Record<string, unknown>;
    const config = readConfig({ ...body, enabled: true });
    const cwd = await resolveModelRequestCwd(typeof body.cwd === "string" ? body.cwd : undefined);
    const startedAt = Date.now();
    const observation = await analyzeImagesWithVisionModel({
      config,
      cwd,
      images: [TEST_IMAGE],
      question: "This is a visual-model connectivity test. Briefly confirm that you received an image; do not infer application state.",
    });
    return NextResponse.json({ ok: true, latencyMs: Date.now() - startedAt, observation: observation.slice(0, 300) });
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) {
      return NextResponse.json({ ok: false, error: "Request body too large" }, { status: 413 });
    }
    if (error instanceof ModelRequestCwdError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
