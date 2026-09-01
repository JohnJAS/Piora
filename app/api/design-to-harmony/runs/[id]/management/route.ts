import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { getDesignManagedStateStore } from "@/lib/design-to-harmony/managed-state-store";
import { getDesignAnalysisRunStore } from "@/lib/design-to-harmony/run-store";
import {
  designErrorResponse,
  designProjectPathsEqual,
  noStoreDesignJson,
  readDesignJson,
  validateDesignProjectRoot,
  validateDesignRelativePaths,
  validateDesignRevision,
  validateDesignRunId,
  validateDesignStateRevision,
} from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await readDesignJson(request);
    const projectRoot = await validateDesignProjectRoot(body.projectRoot);
    const expectedRevision = validateDesignRevision(body.expectedRevision);
    const expectedManagedRevision = validateDesignStateRevision(body.expectedManagedRevision, "expected managed state revision");
    const [relativePath] = validateDesignRelativePaths([body.relativePath], "relativePath");
    if (body.action !== "detach") throw new DesignToHarmonyError("INVALID_ARGUMENT", "Only the detach management action is supported", { status: 400, stage: "review" });
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    const runStore = getDesignAnalysisRunStore();
    const current = runStore.get(id);
    if (!current || !designProjectPathsEqual(current.projectRoot, projectRoot)) throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design run not found for this project", { status: 404, stage: "store" });
    if (current.revision !== expectedRevision) throw new DesignToHarmonyError("PATCH_STALE", "The design run changed before the file could be detached", { status: 409, retryable: true, stage: "review" });
    const state = await getDesignManagedStateStore().setMode(projectRoot, relativePath, "detached", expectedManagedRevision);
    const run = await runStore.save({ ...current, revision: current.revision + 1, updatedAt: new Date().toISOString(), error: undefined });
    return noStoreDesignJson({ run, managedState: state });
  } catch (error) {
    return designErrorResponse(error);
  }
}
