import { analyzeDesignSelection, validateDesignTargets } from "@/lib/design-to-harmony/analysis";
import { readFigmaAccessToken } from "@/lib/design-to-harmony/credential-store";
import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { FigmaSourceAdapter } from "@/lib/design-to-harmony/figma-adapter";
import { getDesignImportStore } from "@/lib/design-to-harmony/import-store";
import { analyzeHarmonyProject } from "@/lib/design-to-harmony/project-analyzer";
import { designAnalysisRunId, getDesignAnalysisRunStore, runDesignAnalysisOnce } from "@/lib/design-to-harmony/run-store";
import type { DesignAnalysisRun } from "@/lib/design-to-harmony/types";
import {
  designErrorResponse,
  designProjectPathsEqual,
  noStoreDesignJson,
  readDesignJson,
  validateDesignProjectRoot,
  validateImportId,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const projectRoot = await validateDesignProjectRoot(new URL(request.url).searchParams.get("projectRoot"));
    return noStoreDesignJson({ runs: getDesignAnalysisRunStore().list(projectRoot) });
  } catch (error) {
    return designErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readDesignJson(request);
    const projectRoot = await validateDesignProjectRoot(body.projectRoot);
    const importId = validateImportId(body.importId);
    const record = getDesignImportStore().get(importId);
    if (!record || !designProjectPathsEqual(record.projectRoot, projectRoot)) {
      throw new DesignToHarmonyError("IMPORT_NOT_FOUND", "Design import not found for this project", { status: 404, stage: "import" });
    }
    const targetNodeIds = validateDesignTargets(record, body.targetNodeIds);
    const store = getDesignAnalysisRunStore();
    const force = body.force === true;
    const cached = store.findCached(projectRoot, importId, record.document.version.id, targetNodeIds);
    if (cached && !force) return noStoreDesignJson({ run: cached, cached: true });

    const id = designAnalysisRunId(projectRoot, importId, record.document.version.id, targetNodeIds);
    const result = await runDesignAnalysisOnce(id, async () => {
      const project = analyzeHarmonyProject(projectRoot);
      const adapter = new FigmaSourceAdapter({ token: readFigmaAccessToken() });
      const { plan } = await analyzeDesignSelection({ record, targetNodeIds, adapter, project });
      const previous = store.get(id);
      const timestamp = new Date().toISOString();
      const run: DesignAnalysisRun = {
        schemaVersion: 1,
        id,
        projectRoot,
        importId,
        sourceVersion: record.document.version.id,
        targetNodeIds,
        status: "planned",
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        plan,
      };
      return store.save(run);
    });
    return noStoreDesignJson({ run: result.run, cached: result.joined }, result.joined ? 200 : 201);
  } catch (error) {
    return designErrorResponse(error);
  }
}
