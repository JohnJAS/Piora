import { FigmaSourceAdapter, parseFigmaSourceUrl } from "@/lib/design-to-harmony/figma-adapter";
import { readFigmaAccessToken } from "@/lib/design-to-harmony/credential-store";
import { designImportId } from "@/lib/design-to-harmony/import-id";
import { getDesignImportStore } from "@/lib/design-to-harmony/import-store";
import type { DesignImportRecord } from "@/lib/design-to-harmony/types";
import { cleanupDesignToHarmonyCaches } from "@/lib/design-to-harmony/maintenance";
import {
  designErrorResponse,
  noStoreDesignJson,
  readDesignJson,
  validateDesignProjectRoot,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const projectRoot = await validateDesignProjectRoot(new URL(request.url).searchParams.get("projectRoot"));
    return noStoreDesignJson({ imports: getDesignImportStore().list(projectRoot) });
  } catch (error) {
    return designErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readDesignJson(request);
    const projectRoot = await validateDesignProjectRoot(body.projectRoot);
    const source = parseFigmaSourceUrl(body.url);
    const forceRefresh = body.forceRefresh === true;
    const store = getDesignImportStore();
    const cached = store.findCached(projectRoot, source);
    if (cached && !forceRefresh) {
      return noStoreDesignJson({ record: cached, cached: true });
    }

    const adapter = new FigmaSourceAdapter({ token: readFigmaAccessToken() });
    const document = await adapter.getDocumentSummary(source, request.signal);
    const timestamp = new Date().toISOString();
    const record: DesignImportRecord = {
      schemaVersion: 1,
      id: designImportId(projectRoot, source.provider, source.fileKey, source.nodeId, document.version.id),
      projectRoot,
      source: { ...source, displayName: document.name },
      document,
      importedAt: cached?.importedAt ?? timestamp,
      updatedAt: timestamp,
    };
    await store.save(record);
    cleanupDesignToHarmonyCaches();
    return noStoreDesignJson({ record, cached: false }, 201);
  } catch (error) {
    return designErrorResponse(error);
  }
}
