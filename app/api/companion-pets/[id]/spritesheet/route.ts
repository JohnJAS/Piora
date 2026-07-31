import { NextResponse } from "next/server";
import {
  CompanionPetError,
  readInstalledPetSpritesheet,
} from "@/lib/companion-pets";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    const { id } = await params;
    const { bytes, mimeType } = readInstalledPetSpritesheet(id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof CompanionPetError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Companion pet spritesheet could not be loaded" },
      { status: 500 },
    );
  }
}
