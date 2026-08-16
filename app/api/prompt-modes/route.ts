import { NextResponse } from "next/server";
import { parseJsonWithinLimit, JsonBodyTooLargeError, InvalidJsonBodyError } from "@/lib/bounded-json";
import { readPromptModeConfig, writePromptModeConfig, type PromptModeConfig } from "@/lib/prompt-modes";
import { invalidateServicesCache } from "@/lib/rpc-manager";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

// GET /api/prompt-modes — availability of the bundled goal/plan prompt modes.
export async function GET() {
  try {
    return NextResponse.json(readPromptModeConfig());
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

function parseBooleanField(body: Record<string, unknown>, key: "goalMode" | "planMode"): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new InvalidJsonBodyError();
  }
  return value;
}

// Compatibility endpoint for older clients. The unified Extensions settings
// page uses /api/extensions and restarts the current idle session as needed.
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await parseJsonWithinLimit(req, 4 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    const patch: Partial<PromptModeConfig> = {};
    const goalMode = parseBooleanField(record, "goalMode");
    const planMode = parseBooleanField(record, "planMode");
    if (goalMode === undefined && planMode === undefined) {
      return NextResponse.json({ error: "Provide at least one of goalMode or planMode" }, { status: 400 });
    }
    if (goalMode !== undefined) patch.goalMode = goalMode;
    if (planMode !== undefined) patch.planMode = planMode;

    const merged = writePromptModeConfig(patch);
    // Bundled extensions are baked into cached AgentSession services; drop the
    // cache so the next session start reloads them with the new availability.
    invalidateServicesCache();
    return NextResponse.json(merged);
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
