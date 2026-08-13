import { InvalidJsonBodyError, JsonBodyTooLargeError, parseJsonWithinLimit } from "@/lib/bounded-json";
import { getHarmonyDeviceManager } from "@/lib/harmony";
import { HarmonyError } from "@/lib/harmony/errors";
import { hasJsonContentType } from "@/lib/request-security";
import { harmonyErrorResponse, noStoreJson, requireHarmonyAccess } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  try {
    const manager = getHarmonyDeviceManager();
    const [config, diagnostics] = await Promise.all([manager.getConfig(), manager.getDiagnostics()]);
    return noStoreJson({ config, diagnostics });
  } catch (error) {
    return harmonyErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  if (!hasJsonContentType(request)) return noStoreJson({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await parseJsonWithinLimit(request, 8 * 1024) as Record<string, unknown>;
    if (body.hdcPath !== null && typeof body.hdcPath !== "string") {
      throw new HarmonyError("INVALID_ARGUMENT", "hdcPath must be an absolute path or null");
    }
    const manager = getHarmonyDeviceManager();
    const config = await manager.updateConfig({ hdcPath: body.hdcPath as string | null });
    return noStoreJson({ config, diagnostics: await manager.getDiagnostics() });
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) return noStoreJson({ error: "Request body is too large" }, { status: 413 });
    if (error instanceof InvalidJsonBodyError) return noStoreJson({ error: "Invalid JSON body" }, { status: 400 });
    return harmonyErrorResponse(error);
  }
}
