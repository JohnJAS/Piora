import { NextResponse } from "next/server";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { ModelRequestCwdError, resolveModelRequestCwd } from "@/lib/model-runtime-context";
import {
  deleteSubagentProfileWithSettings,
  listSubagentProfilesSafe,
  saveSubagentProfileWithSettings,
  type CustomSubagentScope,
} from "@/lib/subagents/profile-manager";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

function errorStatus(error: unknown): number {
  if (error instanceof ModelRequestCwdError) return error.status;
  if (error instanceof JsonBodyTooLargeError) return 413;
  if (error instanceof TypeError || error instanceof InvalidJsonBodyError) return 400;
  return 500;
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonWithinLimit(request, 96_000) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TypeError("Invalid request body");
    }
    const requestedCwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd : undefined;
    const cwd = requestedCwd ? await resolveModelRequestCwd(requestedCwd) : undefined;
    const { profile, settings } = saveSubagentProfileWithSettings(body, cwd);
    const { profiles, warnings } = listSubagentProfilesSafe(cwd);
    return NextResponse.json({ profile, profiles, warnings, settings }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: errorStatus(error), headers },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await parseJsonWithinLimit(request, 16_000) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new TypeError("Invalid request body");
    }
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const scope = body.scope;
    if (!name || (scope !== "user" && scope !== "project")) {
      throw new TypeError("Provide profile name and scope");
    }
    const requestedCwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd : undefined;
    const cwd = requestedCwd ? await resolveModelRequestCwd(requestedCwd) : undefined;
    const { deleted, settings } = deleteSubagentProfileWithSettings(name, scope as CustomSubagentScope, cwd);
    if (!deleted) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404, headers });
    }
    const { profiles, warnings } = listSubagentProfilesSafe(cwd);
    return NextResponse.json({ deleted: true, profiles, warnings, settings }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: errorStatus(error), headers },
    );
  }
}
