import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { SSHValidationError } from "@/lib/ssh/connection";
import { createSSHHost, listSSHHosts } from "@/lib/ssh/host-store";
import { SSHVaultError } from "@/lib/ssh/vault";

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  try { return NextResponse.json({ hosts: listSSHHosts() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(request)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try { return NextResponse.json({ host: await createSSHHost(await parseJsonWithinLimit(request, 2 * 1024 * 1024)) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: error instanceof SSHVaultError ? error.code : "invalid" }, { status: error instanceof SSHVaultError && error.code === "locked" ? 423 : error instanceof SSHValidationError ? 400 : 500 }); }
}
