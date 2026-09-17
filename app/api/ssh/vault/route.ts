import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { lockSSHVault, setSSHMasterPassword, sshVaultStatus, SSHVaultError, unlockSSHVault } from "@/lib/ssh/vault";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  try { return NextResponse.json(await sshVaultStatus(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, 2048) as { action?: unknown; password?: unknown };
    if (body.action === "lock") lockSSHVault();
    else if (body.action === "setup" && typeof body.password === "string") await setSSHMasterPassword(body.password);
    else if (body.action === "unlock" && typeof body.password === "string") await unlockSSHVault(body.password);
    else return NextResponse.json({ error: "Invalid vault action" }, { status: 400 });
    return NextResponse.json(await sshVaultStatus());
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: error instanceof SSHVaultError ? error.code : "invalid" }, { status: error instanceof SSHVaultError && error.code === "unavailable" ? 503 : 400 }); }
}
