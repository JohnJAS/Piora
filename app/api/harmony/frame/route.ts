import { getHarmonyDeviceManager } from "@/lib/harmony";
import { harmonyErrorResponse, requireHarmonyAccess, requiredQuery } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = requireHarmonyAccess(request);
  if (denied) return denied;
  try {
    const serial = requiredQuery(request, "serial");
    const snapshot = await getHarmonyDeviceManager().snapshot({
      serial,
      includeTree: false,
      includeScreenshot: true,
      signal: request.signal,
    });
    if (!snapshot.screenshot) throw new Error("Device screenshot is unavailable");
    return new Response(new Uint8Array(snapshot.screenshot.data), {
      headers: {
        "Content-Type": snapshot.screenshot.mimeType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Harmony-Generation": String(snapshot.generation),
        "X-Harmony-Revision": String(snapshot.revision),
      },
    });
  } catch (error) {
    return harmonyErrorResponse(error);
  }
}
