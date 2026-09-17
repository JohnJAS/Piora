import { NextRequest, NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { getAllowedFileRoots } from "@/lib/file-access";
import { GitWriteError, runGit, validateGitWritePaths } from "@/lib/git-write";
import { invalidateGitStatusCache } from "@/lib/git-status-cache";
import { gitErrorResponse } from "../_shared";

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown>;
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    validateGitWritePaths(cwd, ["."], await getAllowedFileRoots());
    const alreadyGit = await runGit(cwd, ["rev-parse", "--show-toplevel"]).then(() => true, () => false);
    if (alreadyGit) throw new GitWriteError("This directory already belongs to a Git repository", 409, "already_git");
    await runGit(cwd, ["init", "-b", "main"]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const result = gitErrorResponse(error);
    return NextResponse.json(result, { status: result.status });
  } finally { invalidateGitStatusCache(); }
}
