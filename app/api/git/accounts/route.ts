import { NextRequest, NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { availableGitProviders, beginGitLogin, listGitAccounts, pollGitLogin, removeGitAccount, type HostingProvider } from "@/lib/git-accounts";
import { sshVaultStatus } from "@/lib/ssh/vault";
import { gitErrorResponse } from "../_shared";

function failed(error: unknown) {
  const result = gitErrorResponse(error);
  return NextResponse.json(result, { status: result.status });
}

export async function GET() {
  try {
    let providers: Awaited<ReturnType<typeof availableGitProviders>> = [];
    let providerError: string | undefined;
    try { providers = await availableGitProviders(); }
    catch (error) { providerError = error instanceof Error ? error.message : String(error); }
    return NextResponse.json({ accounts: listGitAccounts(), providers, vault: await sshVaultStatus(), providerError });
  } catch (error) { return failed(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown>;
    if (body.action === "start" && ["github", "gitlab", "gitee"].includes(String(body.provider)) && typeof body.site === "string") {
      return NextResponse.json(await beginGitLogin(body.provider as HostingProvider, body.site));
    }
    if (body.action === "poll" && typeof body.operationId === "string") return NextResponse.json(await pollGitLogin(body.operationId));
    return NextResponse.json({ error: "Invalid account request" }, { status: 400 });
  } catch (error) { return failed(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown>;
    if (typeof body.id !== "string") return NextResponse.json({ error: "id is required" }, { status: 400 });
    return NextResponse.json({ accounts: removeGitAccount(body.id) });
  } catch (error) { return failed(error); }
}
