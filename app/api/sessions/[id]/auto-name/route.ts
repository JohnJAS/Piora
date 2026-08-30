import { NextResponse } from "next/server";
import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { generateSessionTitle } from "@/lib/session-title";
import {
  SESSION_TITLE_PROMPT_MAX_LENGTH,
  normalizeSessionTitlePrompt,
} from "@/lib/session-title-prompt";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { invalidateSessionListCache, resolveSessionPath } from "@/lib/session-reader";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const requestText = await req.text();
    let body: {
      instructions?: unknown;
      currentTitle?: unknown;
      apply?: unknown;
      onlyIfUnnamed?: unknown;
      provider?: unknown;
      modelId?: unknown;
    } = {};
    if (requestText) {
      try {
        const parsed = JSON.parse(requestText) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
        }
        body = parsed as typeof body;
      } catch {
        return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
      }
    }
    if (typeof body.instructions === "string" && Array.from(body.instructions).length > SESSION_TITLE_PROMPT_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Session title instructions must not exceed ${SESSION_TITLE_PROMPT_MAX_LENGTH} characters` },
        { status: 400 },
      );
    }
    if (body.instructions !== undefined && typeof body.instructions !== "string") {
      return NextResponse.json({ error: "Session title instructions must be a string" }, { status: 400 });
    }
    if (body.currentTitle !== undefined && typeof body.currentTitle !== "string") {
      return NextResponse.json({ error: "Current title must be a string" }, { status: 400 });
    }
    if (body.apply !== undefined && typeof body.apply !== "boolean") {
      return NextResponse.json({ error: "Apply must be a boolean" }, { status: 400 });
    }
    if (body.onlyIfUnnamed !== undefined && typeof body.onlyIfUnnamed !== "boolean") {
      return NextResponse.json({ error: "Only if unnamed must be a boolean" }, { status: 400 });
    }
    if (body.provider !== undefined && typeof body.provider !== "string") {
      return NextResponse.json({ error: "Provider must be a string" }, { status: 400 });
    }
    if (body.modelId !== undefined && typeof body.modelId !== "string") {
      return NextResponse.json({ error: "Model id must be a string" }, { status: 400 });
    }
    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (Boolean(provider) !== Boolean(modelId)) {
      return NextResponse.json({ error: "Provider and model id must be selected together" }, { status: 400 });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const manager = SessionManager.open(filePath);
    const currentName = manager.getSessionName()?.trim();
    if (body.onlyIfUnnamed === true && currentName) {
      return NextResponse.json({ title: currentName, applied: false, skipped: true, usage: null });
    }

    const cwd = manager.getHeader()?.cwd ?? process.cwd();
    const existing = getRpcSession(id);
    const { session } = existing?.isAlive()
      ? { session: existing }
      : await startRpcSession(id, filePath, cwd);

    // globalThis keeps wrappers alive across dev hot reloads; older instances
    // may predate waitUntilReady(), but those have already completed startup.
    await session.waitUntilReady?.();
    const agentSession = session.inner as unknown as AgentSession;
    const titleModel = provider && modelId
      ? agentSession.modelRuntime.getModel(provider, modelId)
      : undefined;
    if (provider && modelId && !titleModel) {
      return NextResponse.json({ error: `Model not found: ${provider}/${modelId}` }, { status: 404 });
    }
    const result = await generateSessionTitle(agentSession, {
      ...(typeof body.instructions === "string" ? { instructions: normalizeSessionTitlePrompt(body.instructions) } : {}),
      ...(typeof body.currentTitle === "string" ? { currentTitle: Array.from(body.currentTitle).slice(0, 200).join("") } : {}),
      ...(titleModel ? { model: titleModel } : {}),
      signal: req.signal,
    });

    if (!session.isAlive()) {
      return NextResponse.json(
        { error: "The session was closed while its title was being generated. Please try again." },
        { status: 409 },
      );
    }

    const apply = body.apply !== false;
    if (apply) {
      // A manual rename may land while the model is generating. Re-read the
      // append-only session file immediately before applying so automatic
      // naming can never overwrite a title chosen by the user.
      const latestName = body.onlyIfUnnamed === true
        ? SessionManager.open(filePath).getSessionName()?.trim()
        : undefined;
      if (latestName) {
        return NextResponse.json({ title: latestName, applied: false, skipped: true, usage: result.usage ?? null });
      }
      session.setSessionName(result.title);
      invalidateSessionListCache();
    }
    return NextResponse.json({ title: result.title, applied: apply, skipped: false, usage: result.usage ?? null });
  } catch (error) {
    if (req.signal.aborted) {
      return NextResponse.json({ error: "Session title generation was cancelled" }, { status: 499 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
