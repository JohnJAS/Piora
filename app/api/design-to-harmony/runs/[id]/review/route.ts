import { getDesignProjectApplyService } from "@/lib/design-to-harmony/apply-service";
import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { buildDesignPatchSet } from "@/lib/design-to-harmony/patch-builder";
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
    const projectRoot = await validateDesignProjectRoot(new URL(request.url).searchParams.get("projectRoot"));
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    await getDesignProjectApplyService().recover(projectRoot);
    const run = getDesignAnalysisRunStore().get(id);
    if (!run || !designProjectPathsEqual(run.projectRoot, projectRoot)) {
      throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design run not found for this project", { status: 404, stage: "store" });
    }
    if (!run.preview) throw new DesignToHarmonyError("PREVIEW_NOT_FOUND", "Generate an isolated preview before reviewing project changes", { status: 404, stage: "review" });
    const workspace = getDesignPreviewWorkspace();
    const preview = workspace.readManifest(run.id, run.preview.id);
    if (!preview || preview.hash !== run.preview.manifestHash) {
      throw new DesignToHarmonyError("PREVIEW_CONFLICT", "The isolated preview is unavailable or changed", { status: 409, stage: "review" });
    }
    return noStoreDesignJson({ run, patch: buildDesignPatchSet({ run, preview, workspace }) });
  } catch (error) {
    return designErrorResponse(error);
  }
}
