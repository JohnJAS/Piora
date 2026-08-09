import type { NextRequest } from "next/server";
import { getAllowedFileRoots } from "@/lib/file-access";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { GitWriteError, validateGitWritePaths } from "@/lib/git-write";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface GitPathsBody { cwd: string; paths: string[]; raw: Record<string, unknown>; }

export async function readGitPathsBody(request: NextRequest): Promise<GitPathsBody> {
  const body = await parseJsonWithinLimit(request, MAX_BODY_BYTES);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new GitWriteError("Request body must be an object");
  const record = body as Record<string, unknown>;
  const cwd = typeof record.cwd === "string" ? record.cwd.trim() : "";
  const paths = validateGitWritePaths(cwd, record.paths, await getAllowedFileRoots());
  return { cwd, paths, raw: record };
}

export function gitErrorResponse(error: unknown): { error: string; status: number; code?: string; stale?: boolean } {
  if (error instanceof JsonBodyTooLargeError) return { error: error.message, status: 413 };
  if (error instanceof InvalidJsonBodyError) return { error: error.message, status: 400 };
  if (error instanceof GitWriteError) return { error: error.message, status: error.status, code: error.code, stale: error.code === "stale_diff" || undefined };
  return { error: error instanceof Error ? error.message : String(error), status: 500 };
}
