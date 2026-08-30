import { NextResponse } from "next/server";

import {
  CAPABILITY_BUNDLE_MAX_ARCHIVE_BYTES,
  CapabilityBundleError,
  exportCapabilityBundle,
  importCapabilityBundle,
} from "@/lib/capability-bundles";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function assertAllowedCwd(cwd: string): Promise<void> {
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    throw new CapabilityBundleError("Access denied", 403);
  }
}

function errorResponse(error: unknown) {
  const status = error instanceof CapabilityBundleError ? error.status : 500;
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const cwd = new URL(request.url).searchParams.get("cwd")?.trim();
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  try {
    await assertAllowedCwd(cwd);
    const { bytes, manifest } = await exportCapabilityBundle(cwd);
    const date = manifest.createdAt.slice(0, 10);
    const fileName = `piora-capabilities-${date}.piora-bundle`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/vnd.piora.capability-bundle+zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const cwd = new URL(request.url).searchParams.get("cwd")?.trim();
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/zip" && contentType !== "application/vnd.piora.capability-bundle+zip") {
    return NextResponse.json({ error: "Content-Type must be a Piora capability bundle" }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > CAPABILITY_BUNDLE_MAX_ARCHIVE_BYTES) {
    return NextResponse.json({ error: "Capability bundle is too large" }, { status: 413 });
  }
  try {
    await assertAllowedCwd(cwd);
    const bytes = Buffer.from(await request.arrayBuffer());
    return NextResponse.json(await importCapabilityBundle(bytes, cwd));
  } catch (error) {
    return errorResponse(error);
  }
}
