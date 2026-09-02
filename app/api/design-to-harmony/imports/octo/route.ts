import { parseFormDataWithinLimit, RequestBodyTooLargeError } from "@/lib/bounded-form-data";
import { cleanupDesignToHarmonyCaches } from "@/lib/design-to-harmony/maintenance";
import { DesignToHarmonyError } from "@/lib/design-to-harmony/errors";
import { designImportId } from "@/lib/design-to-harmony/import-id";
import { getDesignImportStore } from "@/lib/design-to-harmony/import-store";
import { OCTO_JSON_MAX_BYTES, OctoSourceAdapter, OctoSourceStore, octoSourceRef } from "@/lib/design-to-harmony/octo-adapter";
import type { DesignImportRecord } from "@/lib/design-to-harmony/types";
import { designErrorResponse, noStoreDesignJson, validateDesignProjectRoot } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MULTIPART_BYTES = OCTO_JSON_MAX_BYTES + 128 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(["", "application/json", "text/json", "text/plain", "application/octet-stream"]);

function uploadedFile(value: FormDataEntryValue | null): File {
  if (!(value instanceof File) || value.size <= 0) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", "Select an Octo JSON export file", { status: 400, stage: "import" });
  }
  if (value.size > OCTO_JSON_MAX_BYTES) {
    throw new DesignToHarmonyError("SOURCE_RESPONSE_TOO_LARGE", "Octo JSON files are limited to 16 MB", { status: 413, stage: "import" });
  }
  if (!value.name.toLowerCase().endsWith(".json") || !ALLOWED_MEDIA_TYPES.has(value.type.toLowerCase())) {
    throw new DesignToHarmonyError("INVALID_ARGUMENT", "Octo imports must be JSON export files", { status: 415, stage: "import" });
  }
  return value;
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
      throw new DesignToHarmonyError("INVALID_ARGUMENT", "Content-Type must be multipart/form-data", { status: 415, stage: "import" });
    }
    const form = await parseFormDataWithinLimit(request, MAX_MULTIPART_BYTES);
    const projectRoot = await validateDesignProjectRoot(form.get("projectRoot"));
    const file = uploadedFile(form.get("file"));
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch (error) {
      throw new DesignToHarmonyError("SOURCE_INVALID_RESPONSE", "The Octo export must use UTF-8 JSON", { status: 422, stage: "import", cause: error });
    }

    const sourceStore = new OctoSourceStore();
    const stored = sourceStore.importJson(text, file.name);
    const source = octoSourceRef(stored);
    const store = getDesignImportStore();
    const cached = store.findCached(projectRoot, source);
    if (cached) return noStoreDesignJson({ record: cached, cached: true });

    const document = await new OctoSourceAdapter().getDocumentSummary(source, request.signal);
    const timestamp = new Date().toISOString();
    const record: DesignImportRecord = {
      schemaVersion: 1,
      id: designImportId(projectRoot, source.provider, source.fileKey, source.nodeId, document.version.id),
      projectRoot,
      source: { ...source, displayName: document.name },
      document,
      importedAt: timestamp,
      updatedAt: timestamp,
    };
    await store.save(record);
    cleanupDesignToHarmonyCaches();
    return noStoreDesignJson({ record, cached: false }, 201);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return designErrorResponse(new DesignToHarmonyError("SOURCE_RESPONSE_TOO_LARGE", "Octo upload exceeds the 16 MB limit", { status: 413, stage: "import" }));
    }
    return designErrorResponse(error);
  }
}
