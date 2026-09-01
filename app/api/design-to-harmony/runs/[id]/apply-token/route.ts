import { getDesignProjectApplyService } from "@/lib/design-to-harmony/apply-service";
import { issueDesignApplyToken } from "@/lib/design-to-harmony/apply-token-store";
import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { buildDesignPatchSet } from "@/lib/design-to-harmony/patch-builder";
import { getDesignPreviewWorkspace } from "@/lib/design-to-harmony/preview-workspace";
import { getDesignAnalysisRunStore } from "@/lib/design-to-harmony/run-store";
import type { DesignAnalysisRun } from "@/lib/design-to-harmony/types";
import {
  designErrorResponse,
  designProjectPathsEqual,
  noStoreDesignJson,
  readDesignJson,
  validateDesignProjectRoot,
  validateDesignRelativePaths,
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
    const patchHash = validateDesignSha256(body.patchHash, "reviewed patch hash");
    const overwritePaths = validateDesignRelativePaths(body.overwritePaths ?? [], "overwritePaths");
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    await getDesignProjectApplyService().recover(projectRoot);
    const store = getDesignAnalysisRunStore();
    const current = store.get(id);
    if (!current || !designProjectPathsEqual(current.projectRoot, projectRoot)) {
      throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design run not found for this project", { status: 404, stage: "store" });
    }
    if (current.revision !== expectedRevision) {
      throw new DesignToHarmonyError("PATCH_STALE", "The design run changed after this patch was reviewed", { status: 409, retryable: true, stage: "review", details: { expectedRevision, actualRevision: current.revision } });
    }
    if (!current.preview || !current.plan || current.status === "applying") {
      throw new DesignToHarmonyError("APPLY_BLOCKED", "This design run is not ready for patch approval", { status: 409, stage: "review" });
    }
    const workspace = getDesignPreviewWorkspace();
    const preview = workspace.readManifest(current.id, current.preview.id);
    if (!preview || preview.hash !== current.preview.manifestHash) throw new DesignToHarmonyError("PREVIEW_CONFLICT", "The isolated preview is unavailable or changed", { status: 409, stage: "review" });
    const patch = buildDesignPatchSet({ run: current, preview, workspace });
    if (patch.hash !== patchHash) throw new DesignToHarmonyError("PATCH_STALE", "Project files changed after this patch was reviewed", { status: 409, retryable: true, stage: "review" });
    const overwrite = new Set(overwritePaths);
    const unresolved = patch.files.filter((file) => file.change === "conflict" && !overwrite.has(file.relativePath));
    const invalidOverwrite = patch.files.filter((file) => overwrite.has(file.relativePath) && (!file.overwriteAllowed || file.change !== "conflict"));
    if (unresolved.length || invalidOverwrite.length) {
      throw new DesignToHarmonyError("APPLY_BLOCKED", "Resolve every blocking file conflict before approving this patch", {
        status: 409,
        stage: "review",
        details: { unresolved: unresolved.map((file) => file.relativePath), invalidOverwrite: invalidOverwrite.map((file) => file.relativePath) },
      });
    }
    const actionable = patch.files.some((file) => file.change === "add" || file.change === "modify" || overwrite.has(file.relativePath) || (file.change === "unchanged" && file.managementMode === "unmanaged"));
    if (!actionable) throw new DesignToHarmonyError("APPLY_BLOCKED", "The project already matches this managed design preview", { status: 409, stage: "review" });
    const ready: DesignAnalysisRun = await store.save({ ...current, status: "ready_to_apply", revision: current.revision + 1, updatedAt: new Date().toISOString(), error: undefined });
    const issued = issueDesignApplyToken({ runId: ready.id, projectRoot, expectedRevision: ready.revision, patchHash: patch.hash, overwritePaths });
    return noStoreDesignJson({ run: ready, patch: { ...patch, runRevision: ready.revision }, applyToken: issued.token, expiresAt: issued.expiresAt }, 201);
  } catch (error) {
    return designErrorResponse(error);
  }
}
