import { NextResponse } from "next/server";
import {
  CompanionPetError,
  type CodexPetSourceKind,
  importCodexPet,
  listCompanionPets,
  PET_IMPORT_REQUEST_MAX_BYTES,
} from "@/lib/companion-pets";
import {
  InvalidJsonBodyError,
  JsonBodyTooLargeError,
  parseJsonWithinLimit,
} from "@/lib/bounded-json";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const CODEX_SOURCE_KINDS = new Set<CodexPetSourceKind>([
  "codex-builtin-cache",
  "codex-custom",
  "codex-legacy-avatar",
]);

function errorResponse(error: unknown): NextResponse {
  if (error instanceof CompanionPetError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: "Companion pet request failed" },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    return NextResponse.json(listCompanionPets(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await parseJsonWithinLimit(request, PET_IMPORT_REQUEST_MAX_BYTES);
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) {
      return NextResponse.json({ error: "Import request is too large" }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError) {
      return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
    }
    return errorResponse(error);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    (body as { action?: unknown }).action !== "import" ||
    typeof (body as { id?: unknown }).id !== "string"
  ) {
    return NextResponse.json(
      { error: "Body must contain action=import and a pet id" },
      { status: 400 },
    );
  }
  const requestedSourceKind = (body as { sourceKind?: unknown }).sourceKind;
  if (
    requestedSourceKind !== undefined
    && (
      typeof requestedSourceKind !== "string"
      || !CODEX_SOURCE_KINDS.has(requestedSourceKind as CodexPetSourceKind)
    )
  ) {
    return NextResponse.json(
      { error: "sourceKind is invalid", code: "INVALID_PET_SOURCE" },
      { status: 400 },
    );
  }

  try {
    const result = importCodexPet(
      (body as { id: string }).id,
      process.env,
      requestedSourceKind as CodexPetSourceKind | undefined,
    );
    return NextResponse.json(result, { status: result.replaced ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
