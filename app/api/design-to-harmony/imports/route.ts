import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { FigmaSourceAdapter, parseFigmaSourceUrl } from "@/lib/design-to-harmony/figma-adapter";
import { readFigmaAccessToken } from "@/lib/design-to-harmony/credential-store";
import { getDesignImportStore } from "@/lib/design-to-harmony/import-store";
import type { DesignImportRecord } from "@/lib/design-to-harmony/types";
import {
  designErrorResponse,
  noStoreDesignJson,
  readDesignJson,
  validateDesignProjectRoot,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function importId(projectRoot: string, fileKey: string, nodeId: string | undefined, version: string): string {
  const projectKey = process.platform === "win32" ? resolve(projectRoot).toLowerCase() : resolve(projectRoot);
  const digest = createHash("sha256")
    .update("piora-design-import-v1\0")
    .update(projectKey)
    .update("\0")
    .update(fileKey)
    .update("\0")
    .update(nodeId ?? "")
    .update("\0")
    .update(version)
    .digest("hex")
    .slice(0, 20);
  return `imp_${digest}`;
}

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
      id: importId(projectRoot, source.fileKey, source.nodeId, document.version.id),
      projectRoot,
      source: { ...source, displayName: document.name },
      document,
      importedAt: cached?.importedAt ?? timestamp,
      updatedAt: timestamp,
    };
    await store.save(record);
    return noStoreDesignJson({ record, cached: false }, 201);
  } catch (error) {
    return designErrorResponse(error);
  }
}
