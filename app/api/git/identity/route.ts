import { NextRequest, NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { getAllowedFileRoots } from "@/lib/file-access";
import { GitWriteError, runGit, validateGitWritePaths } from "@/lib/git-write";
import { gitErrorResponse } from "../_shared";

async function authorizedCwd(cwd: unknown): Promise<string> {
  const value = typeof cwd === "string" ? cwd.trim() : "";
  validateGitWritePaths(value, ["."], await getAllowedFileRoots());
  return value;
}

async function identity(cwd: string) {
  const name = await runGit(cwd, ["config", "--get", "user.name"]).then((item) => item.stdout.trim(), () => "");
  const email = await runGit(cwd, ["config", "--get", "user.email"]).then((item) => item.stdout.trim(), () => "");
  return { name, email, configured: !!name && !!email };
}

function failed(error: unknown) {
  const result = gitErrorResponse(error);
  return NextResponse.json(result, { status: result.status });
}

export async function GET(request: NextRequest) {
  try { const cwd = await authorizedCwd(request.nextUrl.searchParams.get("cwd")); return NextResponse.json(await identity(cwd)); }
  catch (error) { return failed(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown>;
    const cwd = await authorizedCwd(body.cwd);
    if (typeof body.name !== "string" || typeof body.email !== "string"
      || !body.name.trim() || body.name.length > 200 || /[\0\r\n]/.test(body.name)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || body.email.length > 254) {
      throw new GitWriteError("Enter a valid Git name and email", 400, "invalid_identity");
    }
    await runGit(cwd, ["config", "--local", "user.name", body.name.trim()]);
    await runGit(cwd, ["config", "--local", "user.email", body.email.trim()]);
    return NextResponse.json(await identity(cwd));
  } catch (error) { return failed(error); }
}
