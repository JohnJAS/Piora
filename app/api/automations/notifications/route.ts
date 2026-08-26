import { NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { getAutomationStore } from "@/lib/automation-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ notifications: getAutomationStore().pendingNotifications() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1_024) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 100) : [];
    return NextResponse.json({ acknowledged: await getAutomationStore().acknowledgeNotifications(ids) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
