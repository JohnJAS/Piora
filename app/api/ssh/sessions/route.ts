import { NextResponse } from "next/server";
import { closeSSHSession, createSSHSession, listSSHSessions } from "@/lib/ssh/session-manager";
import { parseSSHConnection, testSSHConnection, sshErrorCode, SSHValidationError } from "@/lib/ssh/connection";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { parseJsonWithinLimit, InvalidJsonBodyError, JsonBodyTooLargeError } from "@/lib/bounded-json";

export async function POST(request: Request) {
  try {
    if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
    if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    const body = await parseJsonWithinLimit(request, 2 * 1024 * 1024);
    const options = parseSSHConnection(body);
    if ((body as { testOnly?: unknown }).testOnly === true) {
      await testSSHConnection(options, request.signal);
      return NextResponse.json({ tested: true });
    }
    const session = createSSHSession(options);
    const cancel = () => closeSSHSession(session.id);
    request.signal.addEventListener("abort", cancel, { once: true });
    try { request.signal.throwIfAborted(); await session.connect(); }
    catch (error) { closeSSHSession(session.id); throw error; }
    finally { request.signal.removeEventListener("abort", cancel); }
    return NextResponse.json({ snapshot: session.snapshot() });
  } catch (error) {
    const status = error instanceof JsonBodyTooLargeError ? 413 : error instanceof SSHValidationError || error instanceof InvalidJsonBodyError ? 400 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: sshErrorCode(error) }, { status });
  }
}

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  return NextResponse.json({ sessions: listSSHSessions() }, { headers: { "Cache-Control": "no-store" } });
}
