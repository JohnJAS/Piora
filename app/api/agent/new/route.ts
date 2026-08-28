import { NextResponse } from "next/server";
import { getAgentRuntimeProfile } from "@/lib/agent-runtime-profile";
import { createSession, parseSessionThinkingLevel } from "@/lib/session-creation";

type CreationErrorDetails = { status: number; code: string; message: string };

function hasRetryableFilesystemCode(error: unknown): boolean {
  const retryable = new Set(["EACCES", "EBUSY", "ELOCKED", "EMFILE", "ENFILE", "EPERM"]);
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === "object" && retryable.has(String((current as NodeJS.ErrnoException).code ?? ""))) return true;
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

function creationErrorDetails(error: unknown): CreationErrorDetails {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Directory does not exist:")) {
    return { status: 400, code: "SESSION_DIRECTORY_NOT_FOUND", message };
  }
  if (message.startsWith("Invalid thinking level:")) {
    return { status: 400, code: "INVALID_THINKING_LEVEL", message };
  }
  if (message.startsWith("Model is not available in the enabled scope:")) {
    return { status: 409, code: "MODEL_NOT_AVAILABLE", message };
  }
  if (hasRetryableFilesystemCode(error)) {
    return {
      status: 503,
      code: "SESSION_CREATION_RETRYABLE",
      message: "The session runtime is temporarily busy. Please try again.",
    };
  }
  return { status: 500, code: "SESSION_CREATION_FAILED", message };
}
// POST /api/agent/new  body: { cwd: string; type: string; message?: string; ... }
// Spawns a brand-new pi session. Most calls immediately send the first command;
// type:"ensure_session" only creates the runtime so clients can query commands.
// Returns pi's real session id plus the model/thinking state selected at startup.
export async function POST(req: Request) {
  try {
    const runtimeProfile = getAgentRuntimeProfile();
    const body = await req.json() as { cwd?: string; [key: string]: unknown };
    const { cwd, ...command } = body;

    if (!cwd || typeof cwd !== "string") {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    // Use a one-time key so startRpcSession's lock doesn't conflict with real session ids
    const { provider, modelId, toolNames, thinkingLevel, runtimeProfile: requestedRuntimeProfile, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: unknown; runtimeProfile?: unknown; [key: string]: unknown };
    if (requestedRuntimeProfile !== undefined) {
      return NextResponse.json({ error: "runtimeProfile is selected only at process startup" }, { status: 400 });
    }
    if ((provider && !modelId) || (!provider && modelId)) {
      throw new Error("provider and modelId must be provided together");
    }
    const explicitThinkingLevel = parseSessionThinkingLevel(thinkingLevel);
    const created = await createSession({
      cwd,
      ...(toolNames ? { toolNames } : {}),
      ...(provider && modelId ? { initialModel: { provider, modelId } } : {}),
      ...(explicitThinkingLevel ? { thinkingLevel: explicitThinkingLevel } : {}),
      runtimeProfile,
    });
    const { session, sessionId: realSessionId } = created;

    if (promptCommand.type === "ensure_session") {
      return NextResponse.json({
        success: true,
        sessionId: realSessionId,
        data: null,
        model: created.model,
        thinkingLevel: created.thinkingLevel,
        runtimeProfile,
      });
    }

    const result = await session.send(promptCommand);

    return NextResponse.json({
      success: true,
      sessionId: realSessionId,
      data: result,
      model: created.model,
      thinkingLevel: created.thinkingLevel,
      runtimeProfile,
    });
  } catch (error) {
    const details = creationErrorDetails(error);
    if (details.status === 500) console.error("[pi-web] failed to create session:", error);
    return NextResponse.json(
      { error: details.message, code: details.code },
      { status: details.status },
    );
  }
}
