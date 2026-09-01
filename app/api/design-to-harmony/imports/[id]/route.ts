import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { getDesignImportStore } from "@/lib/design-to-harmony/import-store";
import {
  designErrorResponse,
  designProjectPathsEqual,
  noStoreDesignJson,
  validateDesignProjectRoot,
  validateImportId,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await context.params;
    const id = validateImportId(rawId);
    const projectRoot = await validateDesignProjectRoot(new URL(request.url).searchParams.get("projectRoot"));
    const record = getDesignImportStore().get(id);
    if (!record || !designProjectPathsEqual(record.projectRoot, projectRoot)) {
      throw new DesignToHarmonyError("IMPORT_NOT_FOUND", "Design import was not found", { status: 404 });
    }
    return noStoreDesignJson({ record });
  } catch (error) {
    return designErrorResponse(error);
  }
}
