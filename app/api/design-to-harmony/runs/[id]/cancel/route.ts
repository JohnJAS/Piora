import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { getDesignRunOperationRegistry } from "@/lib/design-to-harmony/run-operations";
import { getDesignAnalysisRunStore } from "@/lib/design-to-harmony/run-store";
import { designErrorResponse, designProjectPathsEqual, noStoreDesignJson, readDesignJson, validateDesignProjectRoot, validateDesignRunId } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await readDesignJson(request);
    const projectRoot = await validateDesignProjectRoot(body.projectRoot);
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    const store = getDesignAnalysisRunStore();
    const run = store.get(id);
    if (!run || !designProjectPathsEqual(run.projectRoot, projectRoot)) throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design run not found for this project", { status: 404, stage: "store" });
    if (!getDesignRunOperationRegistry().cancel(id)) throw new DesignToHarmonyError("VALIDATION_CANCELLED", "No cancellable design operation is running", { status: 409, retryable: true, stage: "store" });
    const cancelling = await store.save({ ...run, status: "cancelling", revision: run.revision + 1, updatedAt: new Date().toISOString() });
    return noStoreDesignJson({ run: cancelling }, 202);
  } catch (error) {
    return designErrorResponse(error);
  }
}
