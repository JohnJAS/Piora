import { analyzeHarmonyProject } from "@/lib/design-to-harmony/project-analyzer";
import { designErrorResponse, noStoreDesignJson, validateDesignProjectRoot } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const projectRoot = await validateDesignProjectRoot(new URL(request.url).searchParams.get("projectRoot"));
    return noStoreDesignJson({ project: analyzeHarmonyProject(projectRoot) });
  } catch (error) {
    return designErrorResponse(error);
  }
}
