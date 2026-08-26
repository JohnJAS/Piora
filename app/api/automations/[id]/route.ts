import { NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { getAutomationStore } from "@/lib/automation-store";
import type { UpdateAutomationInput } from "@/lib/automation-types";
import { resolveOrStartRpcSession } from "@/lib/session-runtime-resolver";

export const dynamic = "force-dynamic";

function responseError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 400, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const automation = getAutomationStore().get(id);
  if (!automation) return NextResponse.json({ error: "Automation not found." }, { status: 404 });
  return NextResponse.json({ automation, runs: getAutomationStore().listRuns(id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const patch = await parseJsonWithinLimit(request, 128 * 1_024) as UpdateAutomationInput;
    const store = getAutomationStore();
    const current = store.get(id);
    if (!current) throw new Error("Automation not found.");
    const nextKind = patch.kind ?? current.kind;
    const nextTarget = patch.target ?? current.target;
    let targetSession: Awaited<ReturnType<typeof resolveOrStartRpcSession>> | undefined;
    if (nextKind === "heartbeat" && nextTarget.type === "session") {
      targetSession = await resolveOrStartRpcSession(nextTarget.sessionId);
    }
    const automation = await store.update(id, patch);
    const movedIntoChat = automation.target.type === "session"
      && (current.target.type !== "session" || current.target.sessionId !== automation.target.sessionId);
    if (movedIntoChat) {
      try {
        targetSession?.session.appendAutomationCard({ automationId: automation.id, name: automation.name, rrule: automation.rrule });
      } catch (error) {
        await store.update(id, {
          kind: current.kind,
          name: current.name,
          prompt: current.prompt,
          status: current.status,
          rrule: current.rrule,
          timezone: current.timezone,
          target: current.target,
          notificationPolicy: current.notificationPolicy,
          model: current.model,
          reasoningEffort: current.reasoningEffort,
        });
        throw error;
      }
    }
    return NextResponse.json({ automation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!await getAutomationStore().remove(id)) return NextResponse.json({ error: "Automation not found." }, { status: 404 });
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return responseError(error);
  }
}
