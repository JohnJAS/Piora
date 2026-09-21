import { resolve } from "node:path";
import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { readHarmonyCheckConfig, writeHarmonyCheckConfig } from "@/lib/harmony/check-config";
import { findHarmonyProjectRoot, inspectHarmonyCheckEnvironment, readHarmonyCheckReport, runHarmonyCheck } from "@/lib/harmony/check-runtime";
import type { HarmonyCheckKind } from "@/lib/harmony/check-types";
import { hasJsonContentType } from "@/lib/request-security";
import { noStoreJson, requireHarmonyAccess } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 24 * 1024;

function failure(error: unknown) {
  if (error instanceof JsonBodyTooLargeError) return noStoreJson({ error: "Request body is too large" }, { status: 413 });
  if (error instanceof InvalidJsonBodyError) return noStoreJson({ error: "Invalid JSON body" }, { status: 400 });
  const message = error instanceof Error ? error.message : String(error);
  return noStoreJson({ error: message }, { status: /outside Piora|access/i.test(message) ? 403 : 400 });
}

async function validateProject(value: unknown): Promise<string> {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096) throw new Error("Select a Harmony project first");
  const selected = resolve(value.trim());
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(selected, allowedRoots) || !isExistingFilePathAllowed(selected, allowedRoots)) {
    throw new Error("The project is outside Piora's allowed workspace roots");
  }
  const root = findHarmonyProjectRoot(selected);
  if (!root) throw new Error("No project-level build-profile.json5 was found");
  return root;
}

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  if (!hasJsonContentType(request)) throw new Error("Content-Type must be application/json");
  const body = await parseJsonWithinLimit(request, MAX_BODY_BYTES);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Request body must be an object");
  return body as Record<string, unknown>;
}

export async function GET(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  try {
    const config = readHarmonyCheckConfig();
    const rawProject = new URL(request.url).searchParams.get("cwd");
    const projectRoot = rawProject ? await validateProject(rawProject) : null;
    return noStoreJson({
      config,
      environment: inspectHarmonyCheckEnvironment(config),
      project: projectRoot ? { root: projectRoot, product: config.products[projectRoot] } : null,
      report: projectRoot ? readHarmonyCheckReport(projectRoot) : null,
    });
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  try {
    const body = await bodyOf(request);
    const config = writeHarmonyCheckConfig(body.config ?? body);
    return noStoreJson({ config, environment: inspectHarmonyCheckEnvironment(config) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  try {
    const body = await bodyOf(request);
    const projectRoot = await validateProject(body.projectRoot);
    const checks = body.checks === undefined ? undefined : (() => {
      if (!Array.isArray(body.checks) || !body.checks.length || body.checks.some((item) => item !== "arkts" && item !== "lint")) {
        throw new Error("checks must contain arkts and/or lint");
      }
      return [...new Set(body.checks)] as HarmonyCheckKind[];
    })();
    const files = body.files === undefined ? undefined : (() => {
      if (!Array.isArray(body.files) || body.files.length > 500 || body.files.some((item) => typeof item !== "string" || item.length > 1_024)) {
        throw new Error("files must be a bounded string array");
      }
      return body.files as string[];
    })();
    const product = body.product === undefined ? undefined : (() => {
      if (typeof body.product !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(body.product)) throw new Error("Invalid product name");
      return body.product;
    })();
    const report = await runHarmonyCheck({ projectRoot, checks, files, fix: body.fix === true, product, signal: request.signal });
    return noStoreJson({ report });
  } catch (error) { return failure(error); }
}
