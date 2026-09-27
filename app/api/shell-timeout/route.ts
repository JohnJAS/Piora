import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { readShellTimeoutSettings, writeShellTimeoutSettings } from "@/lib/shell-timeout-settings";

export async function GET() {
  return Response.json(readShellTimeoutSettings(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  try {
    return Response.json(writeShellTimeoutSettings(await parseJsonWithinLimit(request, 1_024)));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
