import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { getDesignPreviewWorkspace } from "@/lib/design-to-harmony/preview-workspace";
import { getDesignAnalysisRunStore } from "@/lib/design-to-harmony/run-store";
import {
  designErrorResponse,
  designProjectPathsEqual,
  noStoreDesignJson,
  validateDesignProjectRoot,
  validateDesignRunId,
} from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url);
    const projectRoot = await validateDesignProjectRoot(url.searchParams.get("projectRoot"));
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    const run = getDesignAnalysisRunStore().get(id);
    if (!run || !designProjectPathsEqual(run.projectRoot, projectRoot)) {
      throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design run not found for this project", { status: 404, stage: "store" });
    }
    if (!run.preview) throw new DesignToHarmonyError("PREVIEW_NOT_FOUND", "Generate an isolated preview first", { status: 404, stage: "preview" });
    const workspace = getDesignPreviewWorkspace();
    const preview = workspace.readManifest(run.id, run.preview.id);
    if (!preview || preview.hash !== run.preview.manifestHash) {
      throw new DesignToHarmonyError("PREVIEW_CONFLICT", "Generated preview manifest is unavailable or changed", { status: 409, stage: "preview" });
    }
    const relativePath = url.searchParams.get("path");
    const file = relativePath ? workspace.readFile(run.id, preview.id, relativePath) : undefined;
    return noStoreDesignJson({ run, preview, ...(file ? { file } : {}) });
  } catch (error) {
    return designErrorResponse(error);
  }
}
