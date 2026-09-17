import { NextRequest, NextResponse } from "next/server";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { getAllowedFileRoots } from "@/lib/file-access";
import { createHostingRepository, listHostingNamespaces } from "@/lib/git-hosting";
import { addGitRemote, listGitRemotes } from "@/lib/git-remotes";
import { GitWriteError, validateGitWritePaths } from "@/lib/git-write";
import { gitErrorResponse } from "../_shared";
import { getGitPublishOperation, saveGitPublishOperation, withGitPublishLock } from "@/lib/git-publish-operations";

function failed(error: unknown) {
  const result = gitErrorResponse(error);
  return NextResponse.json(result, { status: result.status });
}

export async function GET(request: NextRequest) {
  try {
    const accountId = request.nextUrl.searchParams.get("accountId");
    if (!accountId) throw new GitWriteError("accountId is required");
    return NextResponse.json({ namespaces: await listHostingNamespaces(accountId) });
  } catch (error) { return failed(error); }
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonWithinLimit(request, 16 * 1024) as Record<string, unknown>;
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    validateGitWritePaths(cwd, ["."], await getAllowedFileRoots());
    if (typeof body.accountId !== "string" || typeof body.namespaceId !== "string" || typeof body.name !== "string"
      || typeof body.description !== "string" || (body.visibility !== "private" && body.visibility !== "public")
      || typeof body.remoteName !== "string" || typeof body.operationId !== "string"
      || !/^[a-f0-9-]{36}$/.test(body.operationId)) throw new GitWriteError("Invalid repository request");
    return await withGitPublishLock(body.operationId, async () => {
      const requested = {
        id: body.operationId as string, cwd, accountId: body.accountId as string,
        namespaceId: body.namespaceId as string, name: body.name as string,
        description: body.description as string, visibility: body.visibility as "private" | "public",
        remoteName: body.remoteName as string,
      };
      let operation = getGitPublishOperation(requested.id);
      if (operation) {
        for (const key of ["cwd", "accountId", "namespaceId", "name", "description", "visibility"] as const) {
          if (operation[key] !== requested[key]) throw new GitWriteError("Operation ID belongs to another repository request", 409, "operation_mismatch");
        }
        if (operation.phase === "creating") throw new GitWriteError(
          "The previous create request may have reached the hosting service. Check your account and connect the existing repository before retrying.",
          409, "creation_status_uncertain");
      } else {
        operation = { ...requested, phase: "creating", updatedAt: new Date().toISOString() };
        saveGitPublishOperation(operation);
        const created = await createHostingRepository({
          accountId: requested.accountId, namespaceId: requested.namespaceId,
          name: requested.name, description: requested.description, visibility: requested.visibility,
        });
        operation = { ...operation, ...created, phase: "created" };
        saveGitPublishOperation(operation);
      }
      if (!operation.url || !operation.htmlUrl) throw new GitWriteError("Created repository URL is missing", 502, "created_without_url");
      const created = { url: operation.url, htmlUrl: operation.htmlUrl };
      if (operation.phase === "bound") return NextResponse.json({ created: true, bound: true, ...created, remotes: await listGitRemotes(cwd) });
      try {
        const existing = (await listGitRemotes(cwd)).find((item) => item.name === requested.remoteName);
        if (existing && !existing.fetchUrls.includes(operation.url)) throw new GitWriteError("Remote name is already used by a different URL", 409, "remote_name_taken");
        const remotes = existing ? await listGitRemotes(cwd) : await addGitRemote(cwd, requested.remoteName, operation.url);
        saveGitPublishOperation({ ...operation, remoteName: requested.remoteName, phase: "bound" });
        return NextResponse.json({ created: true, bound: true, ...created, remotes });
      } catch (error) {
        return NextResponse.json({ created: true, bound: false, ...created, remotes: await listGitRemotes(cwd),
          bindingError: error instanceof Error ? error.message : String(error) });
      }
    });
  } catch (error) { return failed(error); }
}
