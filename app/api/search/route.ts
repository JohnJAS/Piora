import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { normalizeWorkspaceSearchQuery, searchWorkspace, type WorkspaceSearchMode } from "@/lib/workspace-search";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const query = normalizeWorkspaceSearchQuery(request.nextUrl.searchParams.get("q"));
    const mode: WorkspaceSearchMode = request.nextUrl.searchParams.get("mode") === "content" ? "content" : "files";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!query) return NextResponse.json({ results: [], truncated: false, timedOut: false, engine: "rg" });
    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await searchWorkspace(cwd, query, mode, request.signal));
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json({ error: "Search cancelled" }, { status: 499 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
