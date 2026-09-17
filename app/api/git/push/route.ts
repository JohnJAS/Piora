import { invalidateGitStatusCache } from "@/lib/git-status-cache";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots } from "@/lib/file-access";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { GitWriteError, validateGitWritePaths } from "@/lib/git-write";
import { pushGitToRemote, type GitPushPreview } from "@/lib/git-remotes";
import { gitErrorResponse } from "../_shared";

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonWithinLimit(request, 64 * 1024) as Record<string, unknown>;
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    validateGitWritePaths(cwd, ["."], await getAllowedFileRoots());
    const expected = body.preview as GitPushPreview | undefined;
    if (!expected || typeof expected.remote !== "string" || typeof expected.pushUrl !== "string" || typeof expected.branch !== "string" || typeof expected.targetBranch !== "string"
      || !/^[a-f0-9]{40,64}$/.test(expected.localHead) || (expected.remoteHead !== null && !/^[a-f0-9]{40,64}$/.test(expected.remoteHead))) {
      throw new GitWriteError("A current push preview is required", 400, "preview_required");
    }
    const result = await pushGitToRemote(cwd, expected, body.setUpstream === true);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const result = gitErrorResponse(error);
    return NextResponse.json(result, { status: result.status });
  } finally { invalidateGitStatusCache(); }
}
