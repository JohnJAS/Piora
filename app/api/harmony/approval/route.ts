import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { getHarmonyDeviceManager } from "@/lib/harmony";
import { HarmonyError } from "@/lib/harmony/errors";
import { hasJsonContentType } from "@/lib/request-security";
import { harmonyErrorResponse, noStoreJson, requireHarmonyAccess } from "../_shared";

export const dynamic = "force-dynamic";

/** Runtime creates requests from actual actions; clients cannot invent grants. */
export async function GET(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  const serial = new URL(request.url).searchParams.get("serial");
  return noStoreJson({ approvals: getHarmonyDeviceManager().listApprovals().filter(item => !serial || item.serial === serial) });
}

export async function POST(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  if (!hasJsonContentType(request)) return noStoreJson({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, 8 * 1024) as Record<string, unknown>;
    if (body.action !== "resolve" || typeof body.id !== "string" || typeof body.approved !== "boolean") {
      throw new HarmonyError("INVALID_ARGUMENT", "Resolve an existing runtime approval with id and approved");
    }
    return noStoreJson({ approval: getHarmonyDeviceManager().resolveApproval(body.id, body.approved) });
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) return noStoreJson({ error: "Request body is too large" }, { status: 413 });
    if (error instanceof InvalidJsonBodyError) return noStoreJson({ error: "Invalid JSON body" }, { status: 400 });
    return harmonyErrorResponse(error);
  }
}
