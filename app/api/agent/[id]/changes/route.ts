import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { readPromptFileChanges } from "@/lib/prompt-file-changes";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getRpcSession(id)?.isAlive() && !await resolveSessionPath(id)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  const changes = await readPromptFileChanges(id);
  const query = new URL(request.url).searchParams;
  if (!query.has("path")) {
    return NextResponse.json(changes ? {
      ...changes,
      files: changes.files.map(({ path, kind, additions, deletions, patchRevision }) => ({ path, kind, additions, deletions, patchRevision })),
    } : null);
  }
  const file = changes?.runId === query.get("runId")
    ? changes.files.find((entry) => entry.path === query.get("path"))
    : undefined;
  if (!changes || !file) return NextResponse.json({ error: "Run file not found" }, { status: 404 });
  const roots = await getAllowedFileRoots();
  if (!isFilePathAllowed(file.path, roots) || !isExistingFilePathAllowed(changes.cwd, roots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return NextResponse.json({ patch: file.patch ?? null });
}
