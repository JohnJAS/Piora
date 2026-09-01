import { DesignToHarmonyError, asDesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { getDesignPreviewWorkspace } from "@/lib/design-to-harmony/preview-workspace";
import { getDesignRunOperationRegistry } from "@/lib/design-to-harmony/run-operations";
import { getDesignAnalysisRunStore } from "@/lib/design-to-harmony/run-store";
import { validateDesignRun } from "@/lib/design-to-harmony/validation-service";
import type { DesignAnalysisRun } from "@/lib/design-to-harmony/types";
import {
  designErrorResponse, designProjectPathsEqual, noStoreDesignJson, readDesignJson,
  validateDesignProjectRoot, validateDesignRevision, validateDesignRunId,
} from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function shortSelection(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", `Invalid ${label}`, { status: 400, stage: "build" });
  }
  return value;
}

function deviceSerial(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9._:\[\]-]+$/.test(value)) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", "Invalid device serial", { status: 400, stage: "device" });
  }
  return value;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await readDesignJson(request);
    const projectRoot = await validateDesignProjectRoot(body.projectRoot);
    const expectedRevision = validateDesignRevision(body.expectedRevision);
    const mode = body.mode === undefined || body.mode === "preview" ? "preview" : body.mode === "applied" ? "applied" : undefined;
    if (!mode) throw new DesignToHarmonyError("INVALID_ARGUMENT", "Validation mode must be preview or applied", { status: 400, stage: "build" });
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    const store = getDesignAnalysisRunStore();
    const current = store.get(id);
    if (!current || !designProjectPathsEqual(current.projectRoot, projectRoot)) throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design run not found for this project", { status: 404, stage: "store" });
    if (current.revision !== expectedRevision) throw new DesignToHarmonyError("PREVIEW_CONFLICT", "The design run changed before validation started", { status: 409, retryable: true, stage: "build", details: { expectedRevision, actualRevision: current.revision } });
    if (!current.preview) throw new DesignToHarmonyError("PREVIEW_NOT_FOUND", "Generate an isolated preview before validation", { status: 409, stage: "build" });
    const workspace = getDesignPreviewWorkspace();
    const preview = workspace.readManifest(current.id, current.preview.id);
    if (!preview || preview.hash !== current.preview.manifestHash) throw new DesignToHarmonyError("PREVIEW_CONFLICT", "The generated preview is unavailable or changed", { status: 409, stage: "build" });
    const operations = getDesignRunOperationRegistry();
    const operation = operations.start(id, "validate", request.signal);
    const resumeStatus: DesignAnalysisRun["status"] = current.status === "applied" ? "applied" : "generated";
    const validating = await store.save({ ...current, status: "validating", revision: current.revision + 1, updatedAt: new Date().toISOString(), error: undefined });
    try {
      const validation = await validateDesignRun({
        run: validating,
        preview,
        mode,
        selection: {
          module: shortSelection(body.module, "module"),
          target: shortSelection(body.target, "target"),
          product: shortSelection(body.product, "product"),
          buildMode: body.buildMode === "release" ? "release" : "debug",
        },
        withDevice: body.withDevice === true,
        serial: deviceSerial(body.serial),
        signal: operation.signal,
        onProgress: (stage, message, progress) => operations.progress(id, stage, message, progress),
      });
      const cancelled = validation.build.status === "cancelled" || validation.device?.status === "cancelled" || operation.signal.aborted;
      const completed = await store.save({
        ...validating,
        status: cancelled ? "cancelled" : resumeStatus,
        revision: validating.revision + 1,
        updatedAt: validation.completedAt,
        validation,
        error: cancelled ? { code: "VALIDATION_CANCELLED", message: "Design validation was cancelled", retryable: true } : undefined,
      });
      operations.finish(id, cancelled ? "cancelled" : "completed", "validation", cancelled ? "Design validation cancelled" : "Design validation completed");
      return noStoreDesignJson({ run: completed, validation }, 201);
    } catch (error) {
      const normalized = asDesignToHarmonyError(error);
      const cancelled = operation.signal.aborted;
      await store.save({ ...validating, status: cancelled ? "cancelled" : "failed", revision: validating.revision + 1, updatedAt: new Date().toISOString(), error: { code: cancelled ? "VALIDATION_CANCELLED" : normalized.code, message: cancelled ? "Design validation was cancelled" : normalized.message, retryable: true } });
      operations.finish(id, cancelled ? "cancelled" : "failed", "validation", cancelled ? "Design validation cancelled" : normalized.message);
      throw error;
    }
  } catch (error) {
    return designErrorResponse(error);
  }
}
