import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots } from "@/lib/file-access";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { validateGitWritePaths, GitWriteError } from "@/lib/git-write";
import { addGitRemote, changeGitRemote, listGitRemotes, removeGitRemote } from "@/lib/git-remotes";
import { gitErrorResponse } from "../_shared";

async function authorizedCwd(cwd: unknown): Promise<string> {
  const value = typeof cwd === "string" ? cwd.trim() : "";
  validateGitWritePaths(value, ["."], await getAllowedFileRoots());
  return value;
}

function failed(error: unknown) {
  const result = gitErrorResponse(error);
  return NextResponse.json(result, { status: result.status });
}

export async function GET(request: NextRequest) {
  try {
    const cwd = await authorizedCwd(request.nextUrl.searchParams.get("cwd"));
    return NextResponse.json({ remotes: await listGitRemotes(cwd) });
  } catch (error) { return failed(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown>;
    const cwd = await authorizedCwd(body.cwd);
    if (typeof body.name !== "string" || typeof body.url !== "string") throw new GitWriteError("name and url are required");
    return NextResponse.json({ remotes: await addGitRemote(cwd, body.name, body.url) });
  } catch (error) { return failed(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown>;
    const cwd = await authorizedCwd(body.cwd);
    if (typeof body.name !== "string") throw new GitWriteError("name is required");
    const next: { name?: string; url?: string; pushUrl?: string; replacePushUrl?: string } = {};
    if (typeof body.nextName === "string") next.name = body.nextName;
    if (typeof body.url === "string") next.url = body.url;
    if (typeof body.pushUrl === "string") next.pushUrl = body.pushUrl;
    if (typeof body.replacePushUrl === "string") next.replacePushUrl = body.replacePushUrl;
    if (!next.name && !next.url && !next.pushUrl) throw new GitWriteError("nextName, url or pushUrl is required");
    return NextResponse.json({ remotes: await changeGitRemote(cwd, body.name, next) });
  } catch (error) { return failed(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown>;
    const cwd = await authorizedCwd(body.cwd);
    if (typeof body.name !== "string") throw new GitWriteError("name is required");
    return NextResponse.json({ remotes: await removeGitRemote(cwd, body.name) });
  } catch (error) { return failed(error); }
}
