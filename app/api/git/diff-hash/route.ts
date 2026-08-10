import { NextRequest, NextResponse } from "next/server";
import { computeGitDiffHash } from "@/lib/git-write";
import { gitErrorResponse, readGitPathsBody } from "../_shared";

export async function POST(request: NextRequest) {
  try { const { cwd, paths } = await readGitPathsBody(request); return NextResponse.json({ diffHash: await computeGitDiffHash(cwd, paths) }); }
  catch (error) { const result = gitErrorResponse(error); return NextResponse.json(result, { status: result.status }); }
}
