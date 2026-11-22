import { NextResponse } from "next/server";
import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import { resolveSessionAgentRuntimeProfile } from "@/lib/agent-profile-store";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { SessionRuntimeResolverError } from "@/lib/session-runtime-resolver";
import { readPlanDocument } from "@/lib/workflow/plan-store";
import { parseWorkflowRevision, WorkflowInputError } from "@/lib/workflow-input";
import { getWorkflowRuntime, isWorkflowError, readWorkflowSnapshot, WorkflowError } from "@/lib/workflow-runtime";

type Context = { params: Promise<{ id: string }> };
const noStore = { "Cache-Control": "no-store" };

function failure(error: unknown) {
  const status = error instanceof WorkflowInputError || error instanceof SyntaxError
    ? 400
    : isWorkflowError(error)
      ? error.status
      : error instanceof SessionRuntimeResolverError && error.code === "SESSION_NOT_FOUND"
        ? 404
        : 500;
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string })?.code },
    { status, headers: noStore },
  );
}

async function assertSession(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new WorkflowInputError("Invalid session ID.");
  if (!getRpcSession(id)?.isAlive() && !await resolveSessionPath(id)) {
    throw new SessionRuntimeResolverError("SESSION_NOT_FOUND", "Session not found.");
  }
  await resolveSessionAgentRuntimeProfile(id, getAgentRuntimeProfile());
}

/** Reads the editable PLAN.md content for the current (or requested) plan run without waking a session. */
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await assertSession(id);
    const snapshot = readWorkflowSnapshot(id);
    const requestedRunId = new URL(request.url).searchParams.get("runId");
    const run = requestedRunId
      ? (snapshot.current?.id === requestedRunId
        ? snapshot.current
        : [...snapshot.history].reverse().find(item => item.id === requestedRunId && item.kind === "plan"))
      : (snapshot.current?.kind === "plan"
        ? snapshot.current
        : [...snapshot.history].reverse().find(item => item.kind === "plan"));
    if (!run || run.kind !== "plan") {
      return NextResponse.json({ plan: null, snapshot }, { headers: noStore });
    }
    const diskMarkdown = readPlanDocument(run.planFilePath);
    const editable = snapshot.current?.id === run.id && ["awaiting_approval", "planning", "waiting"].includes(run.status);
    return NextResponse.json({
      plan: {
        runId: run.id,
        version: run.version,
        title: run.title,
        objective: run.objective,
        markdown: diskMarkdown ?? run.markdown,
        filePath: run.planFilePath ?? null,
        editedByUser: Boolean(run.planEditedByUser),
        status: run.status,
        editable,
        revision: snapshot.revision,
      },
      snapshot,
    }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

/** Saves user edits to PLAN.md and broadcasts the updated workflow snapshot. */
export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await assertSession(id);
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new WorkflowInputError("Invalid plan update payload.");
    }
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    const markdown = typeof body.markdown === "string" ? body.markdown : "";
    if (!runId || !markdown.trim()) throw new WorkflowInputError("runId and non-empty markdown are required.");
    const expectedRevision = body.expectedRevision !== undefined
      ? parseWorkflowRevision(body.expectedRevision)
      : undefined;

    const existing = getRpcSession(id);
    let snapshot;
    if (existing?.isAlive()) {
      const result = await existing.send({
        type: "workflow_save_plan",
        runId,
        markdown,
        ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      }) as { snapshot: ReturnType<typeof readWorkflowSnapshot> };
      snapshot = result.snapshot;
    } else {
      // Allow editing a saved plan even after the session has gone idle.
      const runtime = getWorkflowRuntime(id);
      snapshot = runtime.savePlanMarkdown(runId, markdown, expectedRevision);
    }
    const run = snapshot.current;
    if (!run || run.id !== runId) throw new WorkflowError("Plan run is no longer active");
    return NextResponse.json({
      snapshot,
      plan: {
        runId: run.id,
        version: run.version,
        title: run.title,
        objective: run.objective,
        markdown: run.markdown,
        filePath: run.planFilePath ?? null,
        editedByUser: Boolean(run.planEditedByUser),
        status: run.status,
        editable: ["awaiting_approval", "planning", "waiting"].includes(run.status),
        revision: snapshot.revision,
      },
    }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
