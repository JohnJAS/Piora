import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType } from "@/lib/request-security";
import { asDesignToHarmonyError, DesignToHarmonyError } from "@/lib/design-to-harmony/errors";

export const DESIGN_API_MAX_BODY_BYTES = 24 * 1024;

export function noStoreDesignJson(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function designErrorResponse(error: unknown): NextResponse {
  if (error instanceof JsonBodyTooLargeError) {
    return noStoreDesignJson({ error: { code: "INVALID_ARGUMENT", message: error.message, retryable: false } }, 413);
  }
  if (error instanceof InvalidJsonBodyError) {
    return noStoreDesignJson({ error: { code: "INVALID_ARGUMENT", message: error.message, retryable: false } }, 400);
  }
  const normalized = asDesignToHarmonyError(error);
  return noStoreDesignJson({ error: normalized.toJSON() }, normalized.status);
}

export async function readDesignJson(request: Request): Promise<Record<string, unknown>> {
  if (!hasJsonContentType(request)) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", "Content-Type must be application/json", { status: 415 });
  }
  const value = await parseJsonWithinLimit(request, DESIGN_API_MAX_BODY_BYTES);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", "Request body must be an object", { status: 400 });
  }
  return value as Record<string, unknown>;
}

export async function validateDesignProjectRoot(value: unknown): Promise<string> {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", "Select a project before importing a design", { status: 400 });
  }
  const projectRoot = resolve(value.trim());
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(projectRoot, allowedRoots) || !isExistingFilePathAllowed(projectRoot, allowedRoots)) {
    throw new DesignToHarmonyError("PROJECT_ACCESS_DENIED", "The selected project is outside Piora's allowed workspace roots", { status: 403 });
  }
  return projectRoot;
}

export function designProjectPathsEqual(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function validateImportId(value: unknown): string {
  if (typeof value !== "string" || !/^imp_[a-f0-9]{20}$/.test(value)) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", "Invalid design import id", { status: 400 });
  }
  return value;
}

export function validateDesignRunId(value: unknown): string {
  if (typeof value !== "string" || !/^run_[a-f0-9]{20}$/.test(value)) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", "Invalid design analysis run id", { status: 400 });
  }
  return value;
}

export function validateDesignRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", "A positive expectedRevision is required", { status: 400 });
  }
  return value as number;
}

export function validateDesignStateRevision(value: unknown, label = "expected state revision"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", `A non-negative ${label} is required`, { status: 400 });
  }
  return value as number;
}

export function validateDesignSha256(value: unknown, label = "hash"): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", `A valid ${label} is required`, { status: 400 });
  }
  return value;
}

export function validateDesignRelativePaths(value: unknown, label = "paths"): string[] {
  if (!Array.isArray(value) || value.length > 250) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", `${label} must be a bounded array`, { status: 400 });
  }
  const paths = value.map((item) => {
    if (typeof item !== "string" || !item || item.length > 512 || item.includes("\0") || /^[A-Za-z]:/.test(item)) {
      throw new DesignToHarmonyError("INVALID_ARGUMENT", `${label} contains an invalid path`, { status: 400 });
    }
    const normalized = item.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new DesignToHarmonyError("INVALID_ARGUMENT", `${label} contains an unsafe path`, { status: 400 });
    }
    return normalized;
  });
  return [...new Set(paths)].sort();
}
