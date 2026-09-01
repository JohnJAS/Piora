import { getDesignAnalysisIrStore } from "@/lib/design-to-harmony/analysis-ir-store";
import { exportDesignAssets } from "@/lib/design-to-harmony/asset-export";
import { readFigmaAccessToken } from "@/lib/design-to-harmony/credential-store";
import { asDesignToHarmonyError, DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { FigmaSourceAdapter } from "@/lib/design-to-harmony/figma-adapter";
import { getDesignImportStore } from "@/lib/design-to-harmony/import-store";
import { getDesignPreviewWorkspace } from "@/lib/design-to-harmony/preview-workspace";
import { getDesignAnalysisRunStore, runDesignGenerationOnce } from "@/lib/design-to-harmony/run-store";
import { getDesignRunOperationRegistry } from "@/lib/design-to-harmony/run-operations";
import type { DesignAnalysisRun } from "@/lib/design-to-harmony/types";
import {
  designErrorResponse,
  designProjectPathsEqual,
  noStoreDesignJson,
  readDesignJson,
  validateDesignProjectRoot,
  validateDesignRevision,
  validateDesignRunId,
} from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await readDesignJson(request);
    const projectRoot = await validateDesignProjectRoot(body.projectRoot);
    const expectedRevision = validateDesignRevision(body.expectedRevision);
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    const store = getDesignAnalysisRunStore();
    const workspace = getDesignPreviewWorkspace();
    const initial = store.get(id);
    if (!initial || !designProjectPathsEqual(initial.projectRoot, projectRoot)) {
      throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design analysis run not found for this project", { status: 404, stage: "store" });
    }
    if (initial.revision !== expectedRevision) {
      throw new DesignToHarmonyError("PREVIEW_CONFLICT", "The design run changed before generation started", {
        status: 409,
        stage: "generate",
        details: { expectedRevision, actualRevision: initial.revision },
      });
    }
    let reused = false;
    const result = await runDesignGenerationOnce(id, async () => {
      const current = store.get(id);
      if (!current || !designProjectPathsEqual(current.projectRoot, projectRoot)) {
        throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design analysis run not found for this project", { status: 404, stage: "store" });
      }
      if (current.revision !== expectedRevision) {
        throw new DesignToHarmonyError("PREVIEW_CONFLICT", "The design run changed before generation started", {
          status: 409,
          stage: "generate",
          details: { expectedRevision, actualRevision: current.revision },
        });
      }
      if (!current.plan) throw new DesignToHarmonyError("GENERATION_BLOCKED", "Analyze the selected design before generation", { status: 409, stage: "generate" });
      const blockingIssues = current.plan.issues.filter((issue) => issue.severity === "blocking");
      if (blockingIssues.length) {
        throw new DesignToHarmonyError("GENERATION_BLOCKED", "Resolve blocking design issues before generation", {
          status: 409,
          stage: "generate",
          details: { issueIds: blockingIssues.map((issue) => issue.id), issueCodes: blockingIssues.map((issue) => issue.code) },
        });
      }
      if (current.status === "generated" && current.preview) {
        const existing = workspace.readManifest(current.id, current.preview.id);
        if (existing && existing.hash === current.preview.manifestHash && existing.planHash === current.plan.hash) {
          reused = true;
          return current;
        }
      }
      const ir = getDesignAnalysisIrStore().get(current.id);
      if (!ir || ir.sourceImportId !== current.importId || ir.sourceVersion !== current.sourceVersion || ir.hash !== current.plan.irHash) {
        throw new DesignToHarmonyError("IR_NOT_FOUND", "The normalized design snapshot is missing or no longer matches this plan", {
          status: 409,
          retryable: true,
          stage: "generate",
        });
      }
      const startedAt = new Date().toISOString();
      const operations = getDesignRunOperationRegistry();
      const operation = operations.start(current.id, "generate", request.signal);
      const generating: DesignAnalysisRun = {
        ...current,
        status: "generating",
        revision: current.revision + 1,
        updatedAt: startedAt,
        error: undefined,
      };
      await store.save(generating);
      try {
        operations.progress(current.id, "assets", "Exporting design assets", 0.25);
        const designImport = getDesignImportStore().get(current.importId);
        if (!designImport || !designProjectPathsEqual(designImport.projectRoot, current.projectRoot)) {
          throw new DesignToHarmonyError("IMPORT_NOT_FOUND", "The imported design snapshot is no longer available", { status: 409, retryable: true, stage: "generate" });
        }
        const adapter = new FigmaSourceAdapter({ token: readFigmaAccessToken() });
        const exported = await exportDesignAssets({
          adapter,
          source: designImport.source,
          sourceVersion: current.sourceVersion,
          ir,
          plan: current.plan,
          signal: operation.signal,
        });
        operations.progress(current.id, "code", "Generating deterministic ArkUI artifacts", 0.7);
        const preview = workspace.generate(current.id, ir, current.plan, exported.assets, exported.fallbackReasons);
        const completedAt = new Date().toISOString();
        const completed = await store.save({
          ...generating,
          status: "generated",
          revision: generating.revision + 1,
          updatedAt: completedAt,
          preview: {
            id: preview.id,
            manifestHash: preview.hash,
            generatorVersion: preview.generatorVersion,
            artifactCount: preview.artifacts.length,
            totalBytes: preview.totalBytes,
            generatedAt: completedAt,
          },
        });
        operations.finish(current.id, "completed", "preview", "Harmony preview generated");
        return completed;
      } catch (error) {
        const normalized = asDesignToHarmonyError(error);
        const cancelled = operation.signal.aborted;
        await store.save({
          ...generating,
          status: cancelled ? "cancelled" : "failed",
          revision: generating.revision + 1,
          updatedAt: new Date().toISOString(),
          error: cancelled
            ? { code: "VALIDATION_CANCELLED", message: "Design generation was cancelled", retryable: true }
            : { code: normalized.code, message: normalized.message, retryable: normalized.retryable },
        });
        operations.finish(current.id, cancelled ? "cancelled" : "failed", "generate", cancelled ? "Design generation cancelled" : normalized.message);
        throw error;
      }
    });
    if (!result.run.preview) throw new DesignToHarmonyError("GENERATION_FAILED", "Generation completed without a preview manifest", { status: 500, stage: "generate" });
    const preview = workspace.readManifest(result.run.id, result.run.preview.id);
    if (!preview || preview.hash !== result.run.preview.manifestHash) {
      throw new DesignToHarmonyError("PREVIEW_CONFLICT", "Generated preview manifest is unavailable or changed", { status: 409, stage: "preview" });
    }
    const cached = result.joined || reused;
    return noStoreDesignJson({ run: result.run, preview, cached }, cached ? 200 : 201);
  } catch (error) {
    return designErrorResponse(error);
  }
}
