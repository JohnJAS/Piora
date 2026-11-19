import { requireHarmonyDesktopAccess } from "../../../harmony/_shared";
import { parseJsonWithinLimit } from "@/lib/bounded-json";
import { completeDesktopExtensionModel } from "@/lib/desktop-extension-model";
export async function POST(request: Request) {
  const denied = requireHarmonyDesktopAccess(request); if (denied) return denied;
  try {
    const input = await parseJsonWithinLimit(request, 24 * 1024 * 1024);
    return Response.json({ value: await completeDesktopExtensionModel(input, request.signal, true) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Image recognition failed" }, { status: 400 }); }
}
