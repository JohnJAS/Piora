import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { getDesignAnalysisRunStore } from "@/lib/design-to-harmony/run-store";
import {
  designErrorResponse,
  designProjectPathsEqual,
  noStoreDesignJson,
  validateDesignProjectRoot,
  validateDesignRunId,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const projectRoot = await validateDesignProjectRoot(new URL(request.url).searchParams.get("projectRoot"));
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    const run = getDesignAnalysisRunStore().get(id);
    if (!run || !designProjectPathsEqual(run.projectRoot, projectRoot)) {
      throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design analysis run not found for this project", { status: 404, stage: "store" });
    }
    return noStoreDesignJson({ run });
  } catch (error) {
    return designErrorResponse(error);
  }
}
