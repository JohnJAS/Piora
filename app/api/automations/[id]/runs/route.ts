import { NextResponse } from "next/server";
import { getAutomationStore } from "@/lib/automation-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getAutomationStore().get(id)) return NextResponse.json({ error: "Automation not found." }, { status: 404 });
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  return NextResponse.json({ runs: getAutomationStore().listRuns(id, Number.isFinite(limit) ? limit : 50) }, { headers: { "Cache-Control": "no-store" } });
}
