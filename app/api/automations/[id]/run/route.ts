import { NextResponse } from "next/server";
import { getAutomationRuntime } from "@/lib/automation-runtime";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const run = await getAutomationRuntime().runNow(id);
    return NextResponse.json({ run }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : /already running/i.test(message) ? 409 : 400 });
  }
}
