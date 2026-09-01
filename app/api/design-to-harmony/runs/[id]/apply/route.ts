import { getDesignProjectApplyService, runDesignApplyExclusive } from "@/lib/design-to-harmony/apply-service";
import { consumeDesignApplyToken } from "@/lib/design-to-harmony/apply-token-store";
import { asDesignToHarmonyError, DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { getDesignPreviewWorkspace } from "@/lib/design-to-harmony/preview-workspace";
import { getDesignAnalysisRunStore } from "@/lib/design-to-harmony/run-store";
import type { DesignAnalysisRun } from "@/lib/design-to-harmony/types";
import {
  designErrorResponse,
  designProjectPathsEqual,
  noStoreDesignJson,
  readDesignJson,
  validateDesignProjectRoot,
  validateDesignRevision,
  validateDesignRunId,
  validateDesignSha256,
} from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await readDesignJson(request);
    const projectRoot = await validateDesignProjectRoot(body.projectRoot);
    const expectedRevision = validateDesignRevision(body.expectedRevision);
    const patchHash = validateDesignSha256(body.patchHash, "approved patch hash");
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    const preliminary = getDesignAnalysisRunStore().get(id);
    if (!preliminary || !designProjectPathsEqual(preliminary.projectRoot, projectRoot)) {
      throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design run not found for this project", { status: 404, stage: "store" });
    }
    if (preliminary.revision !== expectedRevision) throw new DesignToHarmonyError("PATCH_STALE", "The approved design run is stale", { status: 409, retryable: true, stage: "apply" });

    const result = await runDesignApplyExclusive(projectRoot, async () => {
      const store = getDesignAnalysisRunStore();
      const current = store.get(id);
      if (!current || !designProjectPathsEqual(current.projectRoot, projectRoot) || current.revision !== expectedRevision || current.status !== "ready_to_apply") {
        throw new DesignToHarmonyError("PATCH_STALE", "The approved design run changed before apply", { status: 409, retryable: true, stage: "apply" });
      }
      const token = consumeDesignApplyToken({ token: body.applyToken, runId: id, projectRoot, expectedRevision, patchHash });
      if (!current.preview || !current.plan) throw new DesignToHarmonyError("APPLY_BLOCKED", "The design preview is no longer available", { status: 409, stage: "apply" });
      const workspace = getDesignPreviewWorkspace();
      const preview = workspace.readManifest(current.id, current.preview.id);
      if (!preview || preview.hash !== current.preview.manifestHash) throw new DesignToHarmonyError("PREVIEW_CONFLICT", "The isolated preview is unavailable or changed", { status: 409, stage: "apply" });
      const applying: DesignAnalysisRun = await store.save({ ...current, status: "applying", revision: current.revision + 1, updatedAt: new Date().toISOString(), error: undefined });
      try {
        const output = await getDesignProjectApplyService().apply({ run: applying, preview, expectedPatchHash: patchHash, overwritePaths: token.overwritePaths });
        const applied: DesignAnalysisRun = await store.save({ ...applying, status: "applied", revision: applying.revision + 1, updatedAt: output.applied.appliedAt, lastApply: output.applied, error: undefined });
        return { run: applied, patch: { ...output.patch, runRevision: applied.revision }, applied: output.applied };
      } catch (error) {
        const normalized = asDesignToHarmonyError(error);
        await store.save({ ...applying, status: "failed", revision: applying.revision + 1, updatedAt: new Date().toISOString(), error: { code: normalized.code, message: normalized.message, retryable: normalized.retryable } });
        throw error;
      }
    });
    return noStoreDesignJson(result, 201);
  } catch (error) {
    return designErrorResponse(error);
  }
}
