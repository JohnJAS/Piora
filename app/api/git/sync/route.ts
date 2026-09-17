import { NextRequest, NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { getAllowedFileRoots } from "@/lib/file-access";
import { GitWriteError, validateGitWritePaths } from "@/lib/git-write";
import { fetchGitRemote, finishGitIntegration, gitIntegrationState, pullGitBranch } from "@/lib/git-sync";
import { invalidateGitStatusCache } from "@/lib/git-status-cache";
import { gitErrorResponse } from "../_shared";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd") ?? "";
    validateGitWritePaths(cwd, ["."], await getAllowedFileRoots());
    return NextResponse.json({ integration: await gitIntegrationState(cwd) });
  } catch (error) {
    const result = gitErrorResponse(error);
    return NextResponse.json(result, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown>;
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    validateGitWritePaths(cwd, ["."], await getAllowedFileRoots());
    if (typeof body.action !== "string") throw new GitWriteError("action is required");
    if (body.action === "fetch" && typeof body.remote === "string") await fetchGitRemote(cwd, body.remote);
    else if (body.action === "pull" && typeof body.remote === "string" && typeof body.branch === "string"
      && (body.mode === "ff-only" || body.mode === "merge" || body.mode === "rebase")) {
      await pullGitBranch(cwd, body.remote, body.branch, body.mode);
    } else if (body.action === "continue" || body.action === "abort") await finishGitIntegration(cwd, body.action);
    else throw new GitWriteError("Invalid Git sync request");
    return NextResponse.json({ ok: true, integration: await gitIntegrationState(cwd) });
  } catch (error) {
    const result = gitErrorResponse(error);
    return NextResponse.json(result, { status: result.status });
  } finally { invalidateGitStatusCache(); }
}
