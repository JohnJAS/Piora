import { NextResponse } from "next/server";
import { readSubagentSettings, writeSubagentSettings, listSubagentProfiles } from "@/lib/subagent-settings";
import { stopAllSubagents } from "@/lib/subagent-runtime";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { ModelRequestCwdError, resolveModelRequestCwd } from "@/lib/model-runtime-context";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(request?: Request) {
  try {
    const requested = request ? new URL(request.url).searchParams.get("cwd") : null;
    const cwd = requested ? await resolveModelRequestCwd(requested) : undefined;
    const profiles = listSubagentProfiles(cwd ?? process.cwd()).filter(profile => cwd || profile.source !== "project");
    return NextResponse.json({ settings: readSubagentSettings(), profiles }, { headers });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: error instanceof ModelRequestCwdError ? error.status : 500, headers }); }
}
export async function PUT(request: Request) {
  try {
    const settings = writeSubagentSettings(await parseJsonWithinLimit(request, 64_000));
    if (!settings.enabled) await stopAllSubagents();
    return NextResponse.json({ settings }, { headers });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, {
    status: error instanceof JsonBodyTooLargeError ? 413 : error instanceof TypeError || error instanceof InvalidJsonBodyError ? 400 : 500, headers,
  }); }
}
