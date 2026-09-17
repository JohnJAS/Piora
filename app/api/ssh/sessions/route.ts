import { NextResponse } from "next/server";
import { closeSSHSession, createSSHSession, listSSHSessions, listSSHSessionsForOwner } from "@/lib/ssh/session-manager";
import { parseSSHConnection, testSSHConnection, sshErrorCode, SSHValidationError } from "@/lib/ssh/connection";
import { connectionForSSHHost, getSSHHost, rememberSSHHostFingerprint } from "@/lib/ssh/host-store";
import { changeSSHBinding } from "@/lib/ssh/binding";
import { SSHVaultError } from "@/lib/ssh/vault";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit, InvalidJsonBodyError, JsonBodyTooLargeError } from "@/lib/bounded-json";

export async function POST(request: Request) {
  try {
    if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
    if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    const body = await parseJsonWithinLimit(request, 2 * 1024 * 1024);
    if (!body || typeof body !== "object") throw new SSHValidationError("Invalid connection settings");
    const input = body as Record<string, unknown>;
    const hostId = typeof input.hostId === "string" ? input.hostId : undefined;
    if (hostId && (input.host !== undefined || input.auth !== undefined)) throw new SSHValidationError("Use either a saved host or connection details");
    const savedHost = hostId ? getSSHHost(hostId) : undefined;
    const options = hostId ? await connectionForSSHHost(hostId) : parseSSHConnection(body);
    if (input.testOnly === true) {
      await testSSHConnection(options, request.signal);
      return NextResponse.json({ tested: true });
    }
    const ownerSessionId = typeof input.agentSessionId === "string" && input.agentSessionId.trim() ? input.agentSessionId.trim() : undefined;
    const session = createSSHSession(options, { ...(hostId ? { hostId, hostName: savedHost!.name } : {}), ...(ownerSessionId ? { ownerSessionId } : {}) });
    const cancel = () => closeSSHSession(session.id);
    request.signal.addEventListener("abort", cancel, { once: true });
    try {
      request.signal.throwIfAborted(); await session.connect();
      if (hostId && session.snapshot().hostFingerprint) await rememberSSHHostFingerprint(hostId, session.snapshot().hostFingerprint!);
      if (ownerSessionId) changeSSHBinding(session, ownerSessionId);
    }
    catch (error) { closeSSHSession(session.id); throw error; }
    finally { request.signal.removeEventListener("abort", cancel); }
    return NextResponse.json({ snapshot: session.snapshot() });
  } catch (error) {
    const status = error instanceof JsonBodyTooLargeError ? 413 : error instanceof SSHVaultError && error.code === "locked" ? 423 : error instanceof SSHValidationError || error instanceof InvalidJsonBodyError ? 400 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: sshErrorCode(error) }, { status });
  }
}

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const scope = new URL(request.url).searchParams.get("scope");
  const sessions = scope === null ? listSSHSessions() : listSSHSessionsForOwner(scope === "manual" ? undefined : scope);
  return NextResponse.json({ sessions: sessions.map(({ output: _output, ...snapshot }) => { void _output; return snapshot; }) }, { headers: { "Cache-Control": "no-store" } });
}
