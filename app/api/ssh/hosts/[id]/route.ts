import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { SSHValidationError } from "@/lib/ssh/connection";
import { deleteSSHHost, getSSHHost, updateSSHHost } from "@/lib/ssh/host-store";
import { closeSSHSession, listSSHSessions } from "@/lib/ssh/session-manager";
import { SSHVaultError } from "@/lib/ssh/vault";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  try { return NextResponse.json({ host: getSSHHost((await context.params).id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof SSHValidationError ? 404 : 500 }); }
}
export async function PATCH(request: Request, context: Context) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try { return NextResponse.json({ host: await updateSSHHost((await context.params).id, await parseJsonWithinLimit(request, 2 * 1024 * 1024)) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: error instanceof SSHVaultError ? error.code : "invalid" }, { status: error instanceof SSHVaultError && error.code === "locked" ? 423 : error instanceof SSHValidationError ? 400 : 500 }); }
}
export async function DELETE(request: Request, context: Context) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  const id = (await context.params).id;
  try {
    getSSHHost(id);
    const active = listSSHSessions().filter(session => session.hostId === id);
    if (active.some(session => session.busy)) return NextResponse.json({ error: "Wait for active SSH commands to finish before deleting the host", code: "busy" }, { status: 409 });
    for (const session of active) closeSSHSession(session.id);
    await deleteSSHHost(id);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof SSHValidationError ? 404 : 500 }); }
}
