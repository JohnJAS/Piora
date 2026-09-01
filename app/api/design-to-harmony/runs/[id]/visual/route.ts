import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { designToHarmonyDataRoot } from "@/lib/design-to-harmony/data-root";
import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { getDesignAnalysisRunStore } from "@/lib/design-to-harmony/run-store";
import { designErrorResponse, designProjectPathsEqual, validateDesignProjectRoot, validateDesignRunId } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function within(root: string, path: string): boolean {
  const child = relative(resolve(root), resolve(path));
  return child !== "" && !child.startsWith("..") && !isAbsolute(child);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const url = new URL(request.url);
    const projectRoot = await validateDesignProjectRoot(url.searchParams.get("projectRoot"));
    const kind = url.searchParams.get("kind");
    if (!kind || !["reference", "actual", "diff"].includes(kind)) throw new DesignToHarmonyError("INVALID_ARGUMENT", "Visual artifact kind must be reference, actual, or diff", { status: 400, stage: "visual" });
    const { id: rawId } = await context.params;
    const id = validateDesignRunId(rawId);
    const run = getDesignAnalysisRunStore().get(id);
    if (!run || !designProjectPathsEqual(run.projectRoot, projectRoot)) throw new DesignToHarmonyError("RUN_NOT_FOUND", "Design run not found for this project", { status: 404, stage: "store" });
    const comparison = run.validation?.visual;
    const path = kind === "reference" ? comparison?.referencePath : kind === "actual" ? comparison?.actualPath : comparison?.diffPath;
    if (!path || !existsSync(path)) throw new DesignToHarmonyError("PREVIEW_NOT_FOUND", "Visual comparison artifact is unavailable", { status: 404, stage: "visual" });
    const root = realpathSync(join(resolve(designToHarmonyDataRoot()), "validations", run.id));
    const real = realpathSync(path);
    const details = lstatSync(real);
    if (!within(root, real) || !details.isFile() || details.isSymbolicLink() || details.size > 32 * 1024 * 1024) {
      throw new DesignToHarmonyError("PROJECT_ACCESS_DENIED", "Visual comparison artifact is outside this run's private validation storage", { status: 403, stage: "visual" });
    }
    return new Response(readFileSync(real), { headers: { "Content-Type": "image/png", "Content-Length": String(details.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return designErrorResponse(error);
  }
}
