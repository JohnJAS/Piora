import { NextResponse } from "next/server";

import { savePromptMaterials, type PromptMaterialUpload } from "@/lib/prompt-materials";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { materials?: PromptMaterialUpload[] };
    const materials = savePromptMaterials(body.materials ?? []);
    return NextResponse.json({
      materials: materials.map(({ id, name, byteLength, sha256 }) => ({ id, name, byteLength, sha256 })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
